import test from "node:test";
import assert from "node:assert/strict";
import {profileViewerUrl,parseProfileViewerPayload,VIEW_TOKEN_PATTERN} from "../src/services/profilePublicView.js";
import {renderPublishedTagDetail} from "../src/bot/profileViewerHandlers.js";

test("three public viewer links are opaque, purpose-distinct, and callback-safe",()=>{
 const token="A".repeat(32);
 assert.ok(VIEW_TOKEN_PATTERN.test(token));
 for(const [purpose,prefix] of [["profile","pv"],["media","pm"],["tags","pt"]] as const){
  const url=profileViewerUrl(purpose,token);
  assert.equal(url,"https://t.me/GayBBS_bot?start="+prefix+"_"+token);
  assert.deepEqual(parseProfileViewerPayload(prefix+"_"+token),{purpose,token});
 }
 assert.equal(parseProfileViewerPayload("pm_bad"),null);
 assert.equal(parseProfileViewerPayload("a_"+token),null);
 assert.throws(()=>profileViewerUrl("profile","unsafe!"));
});
test("tag details keep six headings per purpose, no fabricated selection",()=>{
 const value=renderPublishedTagDetail({
  nickname:"テスト",heightCm:175,weightKg:80,age:40,position:"リバ",
  username:"test_user",status:"published",revision:1,
  likeTags:[{category:"パーツ",tag:"乳首"}],
  loveTags:[{category:"性感帯",tag:"耳"}],
 } as any);
 assert.match(value,/💖 #Like｜自分について/);
 assert.match(value,/💘 #Love｜相手に求めること/);
 assert.match(value,/パーツ：#乳首/);
 assert.match(value,/性感帯：#耳/);
 assert.equal(value.split("エロワード：").length-1,2);
 assert.equal(value.split("着衣\/装備：").length-1,2);
});
