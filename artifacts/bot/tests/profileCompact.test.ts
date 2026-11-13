import test from "node:test";
import assert from "node:assert/strict";
import {compactProfileRows,sourceData} from "../src/bot/profileCompactHandlers.js";
import {sendProfileAlbum} from "../src/bot/profileViewerHandlers.js";
import {PROFILE_ALBUM_LIMIT,appendProfileMedia,numberProfileMedia} from "../src/services/profileMedia.js";
import {renderPublicProfile} from "../src/services/profileCore.js";

const draft=(mode:"manual"|"saved"="manual")=>({
 step:"compact" as const,revision:8,
 data:{
  ...(mode==="saved"?{title:"自己紹介",nickname:"ゼロ",heightCm:175,weightKg:80,age:40,position:"タチ" as const}:{}),
  likeTags:[{category:"エロワード",tag:"変態"}],
  loveTags:[{category:"パーツ",tag:"乳首"}],
  purposeCodes:["サシ"],placeCodes:["場所あり"],
  media:[],mediaNextId:1
 }
});
test("compact profile uses the exact recruitment 3+2 controls and distinct Like/Love palette",()=>{
 const markup=compactProfileRows(draft("saved"));
 const rows=markup.reply_markup.inline_keyboard;
 assert.deepEqual(rows.map(row=>row.length),[3,2,2,2]);
 assert.deepEqual(rows[0]?.map(b=>b.text),["✅ ポジション","✅ #Like","✅ #Love"]);
 assert.deepEqual(rows[0]?.map(b=>"style" in b?b.style:undefined),["primary","success","danger"]);
 assert.deepEqual(rows[1]?.map(b=>b.text),["✅ 目的","✅ 場所"]);
 assert.equal(rows[2]?.[0]?.text,"🖼️🎬 アルバム 0/5");
 assert.equal(rows[3]?.[0]?.text,"✅ 保存・3掲示板へ投稿");
 assert.equal(rows[3]?.[1]?.text,"キャンセル");
 assert.equal("style" in rows[3]![1]!?rows[3]![1]!.style:undefined,"danger");
 const fresh=compactProfileRows(draft());
 assert.equal(fresh.reply_markup.inline_keyboard[0]?.[0]?.text,"ポジション選択");
});
test("five Telegram media references form a single private album rather than independent choices",async()=>{
 const media=numberProfileMedia([
  {type:"photo" as const,fileId:"one",sourceMessageId:10},
  {type:"video" as const,fileId:"two",sourceMessageId:11},
  {type:"photo" as const,fileId:"three",sourceMessageId:12},
  {type:"photo" as const,fileId:"four",sourceMessageId:13},
  {type:"video" as const,fileId:"five",sourceMessageId:14}
 ]);
 const calls:any[]=[];
 const telegram={
  sendPhoto:async(...a:any[])=>calls.push(["photo",...a]),
  sendVideo:async(...a:any[])=>calls.push(["video",...a]),
  sendMediaGroup:async(...a:any[])=>calls.push(["album",...a])
 };
 const count=await sendProfileAlbum(telegram as any,123,
  {media,status:"published"} as any);
 assert.equal(count,PROFILE_ALBUM_LIMIT);
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],"album");
 assert.deepEqual(calls[0][2].map((v:any)=>v.type),["photo","video","photo","photo","video"]);
 assert.deepEqual(calls[0][2].map((v:any)=>v.media),["one","two","three","four","five"]);
 assert.throws(()=>appendProfileMedia(media,{type:"photo",fileId:"six",sourceMessageId:15}),
  /PROFILE_ALBUM_FULL/);
 await sendProfileAlbum(telegram as any,123,{media:media.slice(0,1)} as any);
 assert.equal(calls[1][0],"photo");
});
test("stored recruitment-like profile fields are escaped and remain separate from Like/Love",()=>{
 const out=renderPublicProfile({
  title:"<b>自己紹介</b>",nickname:"ゼロ",heightCm:175,weightKg:80,age:40,position:"タチ",
  purposeCodes:["サシ"],placeCodes:["場所あり"],
  likeTags:[{category:"エロワード",tag:"変態"}],
  loveTags:[{category:"パーツ",tag:"乳首"}],
  pr:"テスト"
 });
 assert.match(out,/&lt;b&gt;自己紹介&lt;\/b&gt;/);
 assert.match(out,/#Like/);
 assert.match(out,/#Love/);
 assert.match(out,/目的：#サシ/);
 assert.match(out,/場所：#場所あり/);
});

test("only the original entered values are copied from recruitment, Room or application",()=>{
 const base={
  title:"自己紹介",nickname:"ゼロ",heightCm:175,weightKg:80,age:40,
  position:"タチ",likeTags:[{category:"パーツ",tag:"乳首"}],
  loveTags:[{category:"パーツ",tag:"乳首"}],
 };
 for(const [source,content] of [
  [{...base,body:"相手募集の文章"},"相手募集の文章"],
  [{...base,description:"Room募集の文章"},"Room募集の文章"],
  [{...base,body:"応募の文章"},"応募の文章"],
 ] as const){
  const original=structuredClone(source);
  const result=sourceData(source);
  assert.equal(result.title,"自己紹介");
  assert.equal(result.nickname,"ゼロ");
  assert.equal(result.pr,content);
  assert.equal(result.position,"タチ");
  assert.equal(result.likeTags?.length,1);
  assert.deepEqual(source,original,"profile draft creation may not mutate the source draft");
 }
});
