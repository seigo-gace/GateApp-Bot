import test from "node:test";
import assert from "node:assert/strict";
import {parseRecruitmentMessage} from "../src/services/recruitmentCompose.js";
import {LIKE_CATEGORIES,toggleLike} from "../src/services/profileLike.js";
import {applicationTagRows,renderRoomApplicationPreview} from "../src/services/roomApplicationTags.js";
import {renderRoomApplicantSummary} from "../src/services/announcementApplications.js";

test("ROOM applicant shares profile Like/Love categories and keeps separate toggles",()=>{
 const base=parseRecruitmentMessage("応募する\nゼロ\n170 80 40\n一緒に話したい",false);
 const like=toggleLike([],0,0);
 const love=toggleLike([],1,0);
 const draft={...base,position:"タチ",likeTags:like,loveTags:love};
 const card=renderRoomApplicationPreview(draft);
 assert.match(card,/💖 #Like：#変態/);
 assert.match(card,/💘 #Love：#乳首/);
 assert.match(card,/一緒に話したい/);
 const owner=renderRoomApplicantSummary(draft);
 assert.match(owner,/💖 #Like：#変態/);
 assert.match(owner,/💘 #Love：#乳首/);
 assert.deepEqual(draft.purposeCodes,[]);
 assert.deepEqual(draft.placeCodes,[]);
});

test("tag keyboards reuse original category, pagination, clear and back layout",()=>{
 const cat=applicationTagRows("like",123,{},undefined);
 assert.equal(cat[0]!.length,3);
 assert.equal(cat[1]!.length,3);
 assert.equal(cat[0]![0]!.text,LIKE_CATEGORIES[0]!.name);
 assert.equal(cat[0]![0]!.callback_data,"application:tag:like:123:open:0");
 const item=applicationTagRows("love",123,{},2);
 assert(item.some(row=>row.some(b=>b.callback_data.startsWith("application:tag:love:123:tag:2:"))));
 assert(item.some(row=>row.some(b=>b.callback_data==="application:tag:love:123:clear:2")));
 assert(item.some(row=>row.some(b=>b.callback_data==="application:preview")));
});

test("applicant Like/Love text always escapes user data and validates tags",()=>{
 const base=parseRecruitmentMessage("<room>\n候補\n170 80 40\n& test",false);
 const s=renderRoomApplicationPreview({...base,likeTags:[],loveTags:[]});
 assert.match(s,/&lt;room&gt;/);
 assert.match(s,/&amp; test/);
 assert.match(s,/#Like：/);
 assert.match(s,/#Love：/);
 assert.throws(()=>renderRoomApplicantSummary({...base,likeTags:[{category:"不正",tag:"不正"}]}));
});
