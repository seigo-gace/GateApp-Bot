import test from "node:test";
import assert from "node:assert/strict";
import { PURPOSE_TAGS, PLACE_TAGS, normalizePlaceCodes,
 assertPlaceCodes, validateAnnouncementTags } from "../src/services/announcementTags.js";

test("the adopted Notion purpose list contains precisely 13 unique values", () => {
 assert.equal(PURPOSE_TAGS.length, 13);
 assert.equal(new Set(PURPOSE_TAGS).size, 13);
 assert.deepEqual(PLACE_TAGS, ["場所あり","場所なし","足あり"]);
});
test("place is exclusive and transport option remains independent", () => {
 assert.deepEqual(normalizePlaceCodes("場所あり",true),["場所あり","足あり"]);
 assert.deepEqual(normalizePlaceCodes("場所なし",true),["場所なし","足あり"]);
 assert.deepEqual(normalizePlaceCodes(null,true),["足あり"]);
 assert.doesNotThrow(()=>assertPlaceCodes(["場所あり","足あり"]));
 assert.doesNotThrow(()=>assertPlaceCodes(["場所なし","足あり"]));
 assert.throws(()=>assertPlaceCodes(["場所あり","場所なし"]));
 assert.throws(()=>assertPlaceCodes(["足あり","足あり"]));
});
test("purpose tags refuse invalid and duplicate choices", () => {
 validateAnnouncementTags({purposeCodes:["サシ","旅行"],placeCodes:["場所あり","足あり"]});
 assert.throws(()=>validateAnnouncementTags({purposeCodes:["サシ","サシ"],placeCodes:[]}));
 assert.throws(()=>validateAnnouncementTags({purposeCodes:["未採用"],placeCodes:[]}));
 assert.throws(()=>validateAnnouncementTags({purposeCodes:[],placeCodes:["場所あり","場所なし"]}));
});
