import test from "node:test";
import assert from "node:assert/strict";
import {renderMenuPanel,renderAreaBlockBoard} from "../src/services/menuPanelRenderer.js";
test("M1 only shows previously verified permanent Telegram documents",()=>{
 const x=renderMenuPanel({type:"general_guide",board:"area_bbs",
  links:[{label:"利用規約",url:"https://t.me/c/3847210571/123",verified:true}],
  entryLinks:[]});
 assert.equal(x.rows.length,1);assert.ok(x.text.includes("総合案内"));
 assert.throws(()=>renderMenuPanel({type:"general_guide",board:"area_bbs",
  links:[{label:"規約",url:"https://example.com/draft",verified:true}],entryLinks:[]}));
 assert.throws(()=>renderMenuPanel({type:"general_guide",board:"area_bbs",
  links:[{label:"規約",url:"https://t.me/c/3847210571/123",verified:false}],entryLinks:[]}));
});
test("M2 contains only ready real DM entry links and never placeholder",()=>{
 const x=renderMenuPanel({type:"posting",board:"video_chat",links:[],
  entryLinks:[{feature:"profile",url:"https://t.me/GayBBS_bot?start=m_12345678901234567890123456789012",ready:true},
   {feature:"link",url:"https://t.me/GayBBS_bot?start=m_12345678901234567890123456789012",ready:false}]});
 assert.equal(x.rows.length,1);
 assert.match(x.rows[0]![0]!.text,/プロフ作成/);
 assert.ok(!JSON.stringify(x).includes("ボタン作成"));
});
test("never publish unverified menu or duplicate public labels",()=>{
 assert.throws(()=>renderMenuPanel({type:"posting",board:"gay_board",links:[],entryLinks:[]}),/EMPTY/);
 assert.throws(()=>renderMenuPanel({type:"general_guide",board:"gay_board",
  links:[{label:"規約",url:"https://t.me/c/3770334893/9",verified:true},
   {label:"規約",url:"https://t.me/c/3770334893/10",verified:true}],entryLinks:[]}),/DUPLICATE/);
});

test("M1/M2 verified buttons form compact paired rows with no fake cells",()=>{
 const links=Array.from({length:3},(_,i)=>({
  label:"案内"+i,url:"https://t.me/c/3847210571/"+(i+10),verified:true,
 }));
 const m1=renderMenuPanel({type:"general_guide",board:"area_bbs",
  links,entryLinks:[]});
 assert.deepEqual(m1.rows.map(row=>row.length),[2,1]);
 const m2=renderMenuPanel({type:"posting",board:"area_bbs",links:[],
  entryLinks:["profile","search","announcement","room","link"].map(feature=>({
   feature:feature as "profile"|"search"|"announcement"|"room"|"link",
   url:"https://t.me/GayBBS_bot?start=example",ready:true,
  }))});
 assert.deepEqual(m2.rows.map(row=>row.length),[2,2,1]);
 assert.match(m2.rows[0]![0]!.text,/プロフ/);
 assert.match(m2.rows[0]![1]!.text,/検索/);
 assert.match(m2.rows[1]![0]!.text,/募集/);
 assert.match(m2.rows[1]![1]!.text,/ROOM/);
});
