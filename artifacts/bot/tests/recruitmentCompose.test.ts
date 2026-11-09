import test from "node:test";
import assert from "node:assert/strict";
import {
 parseRecruitmentMessage,changeRecruitmentField,renderRecruitmentPreview,
 validateRecruitmentReady,
} from "../src/services/recruitmentCompose.js";

test("manual recruitment preserves body lines and does not write a profile",()=>{
 const d=parseRecruitmentMessage("今夜の募集\nゼロ\n175 80 40\n集合場所は相談\n時間は夜",false);
 assert.equal(d.mode,"manual");
 assert.equal(d.title,"今夜の募集");
 assert.equal(d.nickname,"ゼロ");
 assert.equal(d.heightCm,175);
 assert.equal(d.weightKg,80);
 assert.equal(d.age,40);
 assert.equal(d.body,"集合場所は相談\n時間は夜");
 assert.deepEqual(d.purposeCodes,[]);
 assert.deepEqual(d.placeCodes,[]);
 assert.match(renderRecruitmentPreview(d),/集合場所は相談\n時間は夜/);
});

test("linked recruitment uses only title and all subsequent body lines",()=>{
 const d=parseRecruitmentMessage("友達募集\n一行目\n二行目",true);
 assert.equal(d.mode,"linked");
 assert.equal(d.body,"一行目\n二行目");
 assert.equal(d.nickname,undefined);
 assert.throws(()=>changeRecruitmentField(d,"nickname","別名"),/PROFILE_LINKED_FIELD_READ_ONLY/);
 assert.throws(()=>validateRecruitmentReady(d),/必須項目/);
});

test("field editing preserves unrelated recruitment fields",()=>{
 const d=parseRecruitmentMessage("募集\nゼロ\n175 80 40\n旧本文",false);
 const e=changeRecruitmentField(d,"body","新本文\nそのまま改行");
 assert.equal(e.body,"新本文\nそのまま改行");
 assert.equal(e.nickname,"ゼロ");
 assert.equal(e.heightCm,175);
 assert.equal(e.title,"募集");
 assert.equal(d.body,"旧本文");
});

test("recruitment input rejects incomplete and unsafe text",()=>{
 assert.throws(()=>parseRecruitmentMessage("タイトルだけ",true));
 assert.throws(()=>parseRecruitmentMessage("タイトル\n名前\n175 80 40",false));
 assert.throws(()=>parseRecruitmentMessage("タイトル\n"+("長".repeat(3001)),true));
 const d=parseRecruitmentMessage("<script>\n本文 & <危険>",true);
 const preview=renderRecruitmentPreview(d,{nickname:"利用者",heightCm:175,weightKg:80,age:40});
 assert.doesNotMatch(preview,/<script>/);
 assert.match(preview,/&lt;script&gt;/);
 assert.match(preview,/&amp;/);
});
