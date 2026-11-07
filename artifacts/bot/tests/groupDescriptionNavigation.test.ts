import test from "node:test";
import assert from "node:assert/strict";
import {FOUR_NAV_KEYS,FOUR_NAV_LABELS,GROUP_ABOUT_TARGETS,
 groupAboutText,fourNamedLinks} from "../src/services/groupDescriptionNavigation.js";
const links=FOUR_NAV_KEYS.map((key,i)=>({
 key,url:"https://t.me/GayBBS_bot?start=gate_test_"+i,verified:true,
}));
test("each of three group descriptions has only its OWN Gate URL and stays within 255",()=>{
 assert.deepEqual(Object.keys(GROUP_ABOUT_TARGETS),["area_bbs","video_chat","gay_board"]);
 for(const key of Object.keys(GROUP_ABOUT_TARGETS) as Array<keyof typeof GROUP_ABOUT_TARGETS>){
  const link=links.find(x=>x.key===key)!;
  const official={key,text:"MASTER_APPROVED_EXACT_COPY_FOR_TEST_ONLY",verified:true,source:"fixture"} as const;
  const description=groupAboutText(key,link,official);
  assert.ok([...description].length<=255,key);
  assert.ok(description.includes("🔗参加はこちら"));
  assert.ok(description.includes(link.url));
  assert.equal((description.match(/https:\/\/t\.me\//g)||[]).length,1);
  assert.ok(!description.includes("<a href="));
  assert.throws(()=>groupAboutText(key,links.find(x=>x.key!==key)!,official),/WRONG_GATE_TARGET/);
  assert.throws(()=>groupAboutText(key,{...link,verified:false},official),/GATE_NOT_VERIFIED/);
  assert.throws(()=>groupAboutText(key,link,{...official,verified:false}),/OFFICIAL_TEXT_NOT_VERIFIED/);
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
