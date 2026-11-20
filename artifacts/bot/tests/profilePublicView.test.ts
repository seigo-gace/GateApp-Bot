import test from "node:test";
import assert from "node:assert/strict";
import {profileViewerUrl,parseProfileViewerPayload,VIEW_TOKEN_PATTERN,profilePanelRows} from "../src/services/profilePublicView.js";
import {renderPublishedTagDetail,profilePanelRich} from "../src/bot/profileViewerHandlers.js";

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

test("public profile keyboard is five independent emoji callbacks plus contact link",()=>{
 const token="A".repeat(32);
 const rows=profilePanelRows(token,"valid_user");
 assert.deepEqual(rows.map(r=>r.map(b=>b.text)),[["🪪","🖼️","🎞️","💖","💘"],["連絡する"]]);
 assert.deepEqual(rows[0]!.map(b=>b.callback_data),["profile","photo","video","like","love"].map(m=>`pfv:show:${token}:${m}`));
 assert.equal(rows[1]![0]!.url,"https://t.me/valid_user");
 assert.equal(profilePanelRows(token,null)[1]![0]!.url,undefined);
});

test("ephemeral public panels separate Like, Love, photo and video without group replies",()=>{
 const p={
  nickname:"掲載者",heightCm:175,weightKg:70,age:40,position:"リバ",
  username:"poster_user",status:"published",revision:1,
  likeTags:[{category:"パーツ",tag:"乳首"}],
  loveTags:[{category:"性感帯",tag:"耳"}],
  media:[{type:"photo",fileId:"photo-file",itemId:1},{type:"video",fileId:"video-file",itemId:2}],
 } as any;
 const like=profilePanelRich(p,"like"),love=profilePanelRich(p,"love");
 assert.match(like.html,/#Like/);
 assert.doesNotMatch(like.html,/#Love/);
 assert.match(love.html,/#Love/);
 assert.doesNotMatch(love.html,/#Like/);
 const photo=profilePanelRich(p,"photo"),video=profilePanelRich(p,"video");
 assert.equal(photo.media?.length,1);
 assert.equal(photo.media?.[0]?.media.type,"photo");
 assert.equal(video.media?.length,1);
 assert.equal(video.media?.[0]?.media.type,"video");
});
