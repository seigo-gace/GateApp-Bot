import test from "node:test";
import assert from "node:assert/strict";
import {FOUR_NAV_KEYS,FOUR_NAV_LABELS,GROUP_ABOUT_TARGETS,
 groupAboutText,fourNamedLinks} from "../src/services/groupDescriptionNavigation.js";
const links=FOUR_NAV_KEYS.map((key,i)=>({
 key,url:"https://t.me/GayBBS_bot?start=gate_test_"+i,verified:true,
}));
test("three official group about texts remain Telegram 255-codepoint-safe",()=>{
 assert.deepEqual(Object.keys(GROUP_ABOUT_TARGETS),["area_bbs","video_chat","gay_board"]);
 for(const key of Object.keys(GROUP_ABOUT_TARGETS) as Array<keyof typeof GROUP_ABOUT_TARGETS>){
  const text=groupAboutText(key);
  assert.ok([...text].length<=255,key+": about length");
  assert.ok(text.length>40);
  assert.equal(FOUR_NAV_LABELS.every(label=>text.includes(label)),true);
  assert.ok(text.includes(GROUP_ABOUT_TARGETS[key].communityTopicUrl));
  assert.ok(!text.includes("<a href="));
 }
});
test("four actual text links are HTML message anchors, one per verified Gate route",()=>{
 const html=fourNamedLinks(links);
 for(const [i,label] of FOUR_NAV_LABELS.entries()){
  assert.ok(html.includes(">"+label+"</a>"),label);
  assert.ok(html.includes(links[i]!.url));
 }
 assert.equal((html.match(/<a href=/g)??[]).length,4);
});
test("no bare topic URL, unverified, wrong or duplicate routes may be published",()=>{
 assert.throws(()=>fourNamedLinks(links.slice(0,3)),/FOUR_LINKS_REQUIRED/);
 assert.throws(()=>fourNamedLinks(links.map((l,i)=>i===3?{...l,url:"https://t.me/c/3847210571/1000"}:l)),/GATE_URL_UNVERIFIED/);
 assert.throws(()=>fourNamedLinks(links.map((l,i)=>i===2?{...l,verified:false}:l)),/GATE_URL_UNVERIFIED/);
 assert.throws(()=>fourNamedLinks([links[0]!,links[0]!,links[2]!,links[3]!]),/UNKNOWN_OR_DUPLICATE/);
});
