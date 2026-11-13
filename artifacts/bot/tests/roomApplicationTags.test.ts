import test from "node:test";
import assert from "node:assert/strict";
import {parseRecruitmentMessage} from "../src/services/recruitmentCompose.js";
import {LIKE_CATEGORIES,toggleLike} from "../src/services/profileLike.js";
import {applicationTagRows,roomChoiceRows,renderRoomApplicationPreview} from "../src/services/roomApplicationTags.js";
import {renderRoomApplicantSummary} from "../src/services/announcementApplications.js";

test("ROOM applicant shares profile Like/Love categories and keeps separate toggles",()=>{
 const base=parseRecruitmentMessage("応募する\nゼロ\n170 80 40\n一緒に話したい",false);
 const like=toggleLike([],0,0);
 const love=toggleLike([],1,0);
 const draft={...base,position:"タチ",likeTags:like,loveTags:love};
 const card=renderRoomApplicationPreview(draft);
 assert.match(card,/#Like：#変態/);
 assert.match(card,/#Love：#乳首/);
 assert.match(card,/一緒に話したい/);
 const owner=renderRoomApplicantSummary(draft);
 assert.match(owner,/#Like：#変態/);
 assert.match(owner,/#Love：#乳首/);
 assert.deepEqual(draft.purposeCodes,[]);
 assert.deepEqual(draft.placeCodes,[]);
});

test("応募 tag panels reuse the actual Room+募集 category, buttons and footer",()=>{
 const cat=applicationTagRows("like",123,{},undefined);
 assert.deepEqual(cat.map(row=>row.length),[3,3,2]);
 assert.equal(cat.slice(0,-1).flat().length,6);
 assert.equal(cat.at(-1)!.length,2);
 assert.equal(cat[0]![0]!.text,LIKE_CATEGORIES[0]!.name);
 assert.equal(cat[0]![0]!.callback_data,"application:tag:like:123:open:0");
 const item=applicationTagRows("love",123,{},2);
 assert(item.some(row=>row.some(b=>b.callback_data.startsWith("application:tag:love:123:tag:2:"))));
 assert(item.some(row=>row.some(b=>b.callback_data==="application:preview")));
 assert(item.some(row=>row.some(b=>b.text==="✅ 保存")));
 assert(item.some(row=>row.some(b=>b.text==="キャンセル")));
 assert(item.every(row=>row.length!==1||row[0]!.text==="キャンセル"));
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

test("4/3/2 adaptive choice rows, no arbitrary singleton and labels are preserved",()=>{
 for(const size of [2,3,4,5,6,7,8,9,10,11,12]){
  const items=Array.from({length:size},(_,i)=>({text:"短"+i,callback_data:"callback:"+i}));
  const rows=roomChoiceRows(items);
  assert(rows.every(row=>row.length>=2&&row.length<=4),"size="+size);
  assert.deepEqual(rows.flat(),items);
 }
 for(const size of [3,5,7,9]){
  const long=Array.from({length:size},(_,i)=>({text:"長めの候補テキスト"+i}));
  const rows=roomChoiceRows(long);
  assert.deepEqual(rows.flat(),long);
  assert(rows.every(r=>r.length>=2&&r.length<=3));
 }
});
test("ROOM tag controls preserve 募集+Room footer without singleton candidate rows",()=>{
 const rows=applicationTagRows("like",123,{likeTags:[]},2,0);
 assert(rows.every(row=>row.length<=4));
 const singles=rows.filter(row=>row.length===1);
 assert(singles.every(row=>row[0]!.text==="キャンセル"));
});

test("all paged Like/Love candidate screens avoid single-button navigation",()=>{
 for(const purpose of ["like","love"] as const){
  for(let category=0;category<LIKE_CATEGORIES.length;category++){
   const pages=Math.ceil(LIKE_CATEGORIES[category]!.items.length/12);
   for(let page=0;page<pages;page++){
    const rows=applicationTagRows(purpose,234,{},category,page);
    assert(rows.every(row=>row.length<=4),"more than four buttons");
    assert(rows.every(row=>row.length!==1||row[0]!.text==="キャンセル"),
      "unwanted singleton category="+category+" page="+page);
   }
  }
 }
});

test("ROOM応募 and 募集+Room tag panels use 3/4 columns and shared red-cancel footer",()=>{
 for(const purpose of ["like","love"] as const){
  for(let category=0;category<LIKE_CATEGORIES.length;category++){
   const total=LIKE_CATEGORIES[category]!.items.length;
   const pages=Math.ceil(total/12);
   for(let page=0;page<pages;page++){
    const rows=applicationTagRows(purpose,987,{},category,page);
    const footer=rows.at(-1)!;
    const next=page+1<pages;
    assert.deepEqual(footer.map(b=>b.text),
     ["↩ 戻る","✅ 保存","キャンセル",...(next?["次 ➡️"]:[])]);
    assert.deepEqual(footer.map(b=>b.style),
     [undefined,"success","danger",...(next?["primary"]:[])]);
    assert.equal(footer[0]!.callback_data,
     page>0?`application:tag:${purpose}:987:page:${category}:${page-1}`:
      `application:tag:${purpose}:987:back`);
    if(next)assert.equal(footer[3]!.callback_data,
     `application:tag:${purpose}:987:page:${category}:${page+1}`);
    const candidates=rows.slice(0,-1);
    assert(candidates.every(row=>row.length>=2&&row.length<=4));
    assert(candidates.every(row=>row.length>=3)||total-page*12<=2);
    assert(candidates.flat().every(b=>b.style===(purpose==="like"?"success":"danger")));
    assert(candidates.every(row=>row.every(b=>!b.text.includes("次")&&!b.text.includes("戻る"))));
   }
  }
 }
});
