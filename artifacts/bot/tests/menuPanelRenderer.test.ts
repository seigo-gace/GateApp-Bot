import test from "node:test";
import assert from "node:assert/strict";
import {renderMenuPanel} from "../src/services/menuPanelRenderer.js";
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
