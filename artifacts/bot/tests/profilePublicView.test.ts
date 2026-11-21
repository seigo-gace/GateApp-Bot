import test from "node:test";
import assert from "node:assert/strict";
import {profileViewerUrl,parseProfileViewerPayload,VIEW_TOKEN_PATTERN,profilePanelRows} from "../src/services/profilePublicView.js";
import {renderPublishedTagDetail,profilePanelRich,profileSearchHashtag} from "../src/bot/profileViewerHandlers.js";
import {LIKE_CATEGORIES} from "../src/services/profileLike.js";

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

test("all six canonical categories and every original candidate become a single searchable hashtag",()=>{
 const all=LIKE_CATEGORIES.flatMap(c=>c.items.map(tag=>({category:c.name,tag})));
 assert.equal(LIKE_CATEGORIES.length,6);
 assert.equal(all.length,140,"keep the established 140 entries; never silently drop choices");
 for(const {tag} of all){
  const hashtag=profileSearchHashtag(tag);
  assert.match(hashtag,/^#[\p{L}\p{N}_]+(?: #[\p{L}\p{N}_]+)*$/u,tag);
  assert.ok(hashtag.length>1,tag);
 }
 const fixture={nickname:"掲載者",heightCm:175,weightKg:75,age:40,position:"リバ",
  status:"published",revision:2,likeTags:all,loveTags:all} as any;
 for(const mode of ["like","love"] as const){
  const rendered=profilePanelRich(fixture,mode).html;
  for(const {tag} of all)assert.ok(rendered.includes(profileSearchHashtag(tag)),mode+":"+tag);
  for(const {name} of LIKE_CATEGORIES)assert.ok(rendered.includes(name+"："));
  assert.equal((rendered.match(/<br\/>/g)||[]).length,6);
 }
 assert.equal(profileSearchHashtag("縛りたい[緊縛]"),"#縛りたい #緊縛");
 assert.equal(profileSearchHashtag("露出/野外"),"#露出 #野外");
 assert.equal(profileSearchHashtag("飲み/飯"),"#飲み #飯");
 assert.equal(profileSearchHashtag("3p/4p"),"#3p #4p");
});

test("published media uses a true rich collage for 2-5 photos/videos, with one-item fallback",()=>{
 const fixture={nickname:"掲載者",heightCm:175,weightKg:75,age:40,position:"リバ",
  status:"published",revision:2,media:[
  {type:"photo",fileId:"photo1",itemId:1},
  {type:"video",fileId:"video2",itemId:2},
  {type:"photo",fileId:"photo3",itemId:3},
  {type:"video",fileId:"video4",itemId:4},
  {type:"photo",fileId:"photo5",itemId:5}
 ]} as any;
 const photos=profilePanelRich(fixture,"photo"),videos=profilePanelRich(fixture,"video");
 assert.equal(photos.media?.length,3);
 assert.equal(videos.media?.length,2);
 assert.match(photos.html,/<tg-collage>.*<\/tg-collage>/);
 assert.match(videos.html,/<tg-collage>.*<\/tg-collage>/);
 assert.equal((photos.html.match(/<img /g)||[]).length,3);
 assert.equal((videos.html.match(/<video /g)||[]).length,2);
 assert.deepEqual(photos.media?.map(x=>x.media.media),["photo1","photo3","photo5"]);
 assert.deepEqual(videos.media?.map(x=>x.media.media),["video2","video4"]);
 const only=profilePanelRich({...fixture,media:[fixture.media[1]]},"video");
 assert.ok(!only.html.includes("<tg-collage>"));
 assert.equal(only.media?.length,1);
 const empty=profilePanelRich({...fixture,media:[]},"photo");
 assert.equal(empty.media,undefined);
 assert.match(empty.html,/登録されていません/);
});

test("published card and preview split punctuated tags independently without modifying stored tags",async()=>{
 const {renderPublicProfile,renderProfileBasicPreview}=await import("../src/services/profileCore.js");
 const base={
  nickname:"プロフィール",heightCm:175,weightKg:70,age:40,position:"リバ" as const,
  likeTags:[{category:"プレイ",tag:"露出/野外"}],
  loveTags:[{category:"プレイ",tag:"縛りたい[緊縛]"}],
  purposeCodes:["飲み/飯"],placeCodes:["露出/野外"]
 };
 const expected=["#露出 #野外","#縛りたい #緊縛","#飲み #飯"];
 const publicText=renderPublicProfile(base);
 const preview=renderProfileBasicPreview(base,"poster_user");
 for(const fragment of expected){
  assert.ok(publicText.includes(fragment),fragment);
  assert.ok(preview.includes(fragment),fragment);
 }
 assert.equal(base.likeTags[0]?.tag,"露出/野外");
 assert.equal(base.loveTags[0]?.tag,"縛りたい[緊縛]");
});
