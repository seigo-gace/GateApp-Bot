import test from "node:test";
import assert from "node:assert/strict";
import {
  renderMenuPanel,renderAreaBlockBoard,renderApprovedLinks,approvedLayoutRows,
  APPROVED_POSTING_ROWS,APPROVED_GUIDE_ROWS,APPROVED_HELP_ROWS,
} from "../src/services/menuPanelRenderer.js";

const makeLinks=(labels:readonly (readonly string[])[]) =>
 labels.flat().map((label,i)=>({
  label,url:"https://t.me/c/3847210571/"+(i+100),verified:true
 }));

test("Master-approved posting rows remain exactly 3/1/2/3, without profile or filler",()=>{
 const result=renderMenuPanel({type:"posting",board:"area_bbs",
  links:makeLinks(APPROVED_POSTING_ROWS),entryLinks:[]});
 assert.deepEqual(result.rows.map(r=>r.map(b=>b.text)),APPROVED_POSTING_ROWS.map(r=>[...r]));
 assert.deepEqual(result.rows.map(r=>r.length),[3,1,2,3]);
 assert.ok(!result.rows.flat().some(x=>x.text.includes("プロフ")));
});
test("Master-approved general-guide rows remain exactly six pairs",()=>{
 const result=renderMenuPanel({type:"general_guide",board:"gay_board",
  links:makeLinks(APPROVED_GUIDE_ROWS),entryLinks:[]});
 assert.deepEqual(result.rows.map(r=>r.map(b=>b.text)),APPROVED_GUIDE_ROWS.map(r=>[...r]));
 assert.deepEqual(result.rows.map(r=>r.length),[2,2,2,2,2,2]);
});
test("Master-approved help rows remain exactly two rows of three",()=>{
 const rows=renderApprovedLinks("operation_help",makeLinks(APPROVED_HELP_ROWS));
 assert.deepEqual(rows.map(r=>r.map(b=>b.text)),APPROVED_HELP_ROWS.map(r=>[...r]));
 assert.deepEqual(approvedLayoutRows("operation_help"),APPROVED_HELP_ROWS);
 assert.equal(rows[1]?.[2]?.text,"戻る");
});
test("publishing incomplete or unverified menu is rejected, not auto-padded",()=>{
 const links=makeLinks(APPROVED_POSTING_ROWS);
 assert.throws(()=>renderMenuPanel({type:"posting",board:"area_bbs",
  links:links.slice(0,8),entryLinks:[]}),/MISSING_VERIFIED/);
 assert.throws(()=>renderMenuPanel({type:"posting",board:"area_bbs",
  links:[...links,{...links[0]!}],entryLinks:[]}),/DUPLICATE/);
 assert.throws(()=>renderMenuPanel({type:"posting",board:"area_bbs",
  links:[...links.slice(0,8),{...links[8]!,verified:false}],entryLinks:[]}),/NOT_VERIFIED/);
 assert.throws(()=>renderMenuPanel({type:"posting",board:"area_bbs",
  links:[],entryLinks:[{feature:"link",label:"検索/フィルター",
   url:"https://t.me/GayBBS_bot",ready:true}]}),/POSTING_ENTRY_NOT_APPROVED/);
});
test("guide requires published official links and rejects guessed ones",()=>{
 const links=makeLinks(APPROVED_GUIDE_ROWS);
 assert.throws(()=>renderMenuPanel({type:"general_guide",board:"area_bbs",
  links:[...links.slice(0,11),{...links[11]!,url:"https://example.com"}],entryLinks:[]}),/NOT_VERIFIED/);
 assert.throws(()=>renderMenuPanel({type:"general_guide",board:"area_bbs",
  links,entryLinks:[{feature:"profile",url:"https://t.me/GayBBS_bot",ready:true}]}),/FORBIDDEN/);
});
test("area board retains search+filter and chat+back without placeholder",()=>{
 const link=(label:string,n:number)=>({label,url:"https://t.me/c/3847210571/"+n,verified:true});
 const result=renderAreaBlockBoard({blockTitle:"全国エリア",description:"エリアを選んでください",
  areaLinks:[link("東京",101),link("大阪",102),link("福岡",103)],
  searchLink:link("検索",104),filterLink:link("フィルター",105),
  chatLink:link("雑談",106),backLink:link("戻る",107)});
 assert.deepEqual(result.rows.map(row=>row.length),[2,1,2,2]);
 assert.deepEqual(result.rows.at(-2)?.map(x=>x.text),["検索","フィルター"]);
});

test("posting panel merges five verified DM editors and four verified navigation URLs",()=>{
 const staticLabels=["クリエーター有料ビデオ投稿",
  "雑談","紹介/招待","操作説明"];
 const links=staticLabels.map((label,i)=>({label,
  url:"https://t.me/c/3847210571/"+(500+i),verified:true}));
 const entryLinks=[
  {label:"相手募集",feature:"announcement",url:"https://t.me/GayBBS_bot?start=r_123",ready:true},
  {label:"募集+Room",feature:"room",url:"https://t.me/GayBBS_bot?start=m_123",ready:true},
  {label:"告知/予告",feature:"announcement",url:"https://t.me/GayBBS_bot?start=m_456",ready:true},
  {label:"🔗ボタン作成",feature:"link",url:"https://t.me/GayBBS_bot?start=m_789",ready:true},
  {label:"検索/フィルター",feature:"search",url:"https://t.me/GayBBS_bot?start=m_900",ready:true},
 ] as const;
 const result=renderMenuPanel({type:"posting",board:"video_chat",links,
  entryLinks:[...entryLinks]});
 assert.deepEqual(result.rows.map(row=>row.map(x=>x.text)),
  APPROVED_POSTING_ROWS.map(row=>[...row]));
 assert.deepEqual(result.rows.map(row=>row.length),[3,1,2,3]);
 assert.ok(result.rows[0][0]!.url.includes("start=r_"));
 assert.equal(result.rows[2][0]!.text,"🔗ボタン作成");
 assert.throws(()=>renderMenuPanel({type:"posting",board:"video_chat",links,
  entryLinks:entryLinks.slice(0,3) as any}),/MISSING_VERIFIED/);
 assert.throws(()=>renderMenuPanel({type:"posting",board:"video_chat",links,
  entryLinks:[...entryLinks.slice(0,3),{...entryLinks[3],ready:false}]}),/NOT_VERIFIED/);
});
