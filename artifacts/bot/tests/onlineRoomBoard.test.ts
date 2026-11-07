import test from "node:test";
import assert from "node:assert/strict";
import {ONLINE_MEDIA,ONLINE_CARD_ORDER,ONLINE_HISTORICAL_TARGETS,
 renderOnlineRoomCards} from "../src/services/onlineRoomBoard.js";

const links=[
 {group:"area_bbs" as const,gateStartUrl:"https://t.me/ExistingGateBot?start=a_abc",verified:true},
 {group:"video_chat" as const,gateStartUrl:"https://t.me/ExistingGateBot?start=v_def",verified:true},
 {group:"gay_board" as const,gateStartUrl:"https://t.me/ExistingGateBot?start=g_ghi",verified:true},
];
test("ONLINE four independent image posts in adopted intro, area, video, gay order",()=>{
 const cards=renderOnlineRoomCards(links);
 assert.equal(cards.length,4);
 assert.deepEqual(cards.map(c=>c.key),ONLINE_CARD_ORDER);
 assert.deepEqual(cards.map(c=>c.button.text),[
  "↩ 総合案内へ戻る","🎬 ROOM掲示板へ","🎬 ROOM掲示板へ","🎬 ROOM掲示板へ",
 ]);
 assert.equal(cards[0]?.button.url,"https://t.me/c/3847210571/43");
 assert.deepEqual(cards.slice(1).map(c=>c.button.url),links.map(l=>l.gateStartUrl));
 assert.deepEqual(cards.map(c=>c.image.filename),[
  "00_ONLINE案内_1080.jpg","01_エリアsBBS_1080.png",
  "02_ビデオChat_1080.jpg","03_ゲイ掲示板_1080.jpg",
 ]);
 assert.deepEqual(Object.keys(ONLINE_MEDIA),ONLINE_CARD_ORDER);
 assert.equal(new Set(cards.map(c=>c.image.driveFileId)).size,4);
 for(const card of cards){
  assert.ok(card.caption.length>40&&card.caption.length<=1024);
  assert.match(card.caption,/ROOM/);
 }
});
test("ONLINE gate links must be complete, unique, verified Bot START",()=>{
 assert.throws(()=>renderOnlineRoomCards(links.slice(0,2)),/INCOMPLETE/);
 assert.throws(()=>renderOnlineRoomCards([links[0]!,links[0]!,links[2]!]),/DUPLICATE/);
 assert.throws(()=>renderOnlineRoomCards([{...links[0]!,verified:false},...links.slice(1)]),/NOT_VERIFIED/);
 assert.throws(()=>renderOnlineRoomCards([{...links[0]!,gateStartUrl:"https://t.me/c/3847210571/116"},...links.slice(1)]),/INVALID/);
 assert.throws(()=>renderOnlineRoomCards([{...links[0]!,gateStartUrl:"https://example.com"},...links.slice(1)]),/INVALID/);
});
test("historical ROOM targets are preserved for gate routing only",()=>{
 assert.equal(ONLINE_HISTORICAL_TARGETS.area_bbs,"https://t.me/c/3847210571/116");
 assert.equal(ONLINE_HISTORICAL_TARGETS.video_chat,"https://t.me/c/2373696859/1605");
 assert.equal(ONLINE_HISTORICAL_TARGETS.gay_board,"https://t.me/c/3770334893/4");
});
