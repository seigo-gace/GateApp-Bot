import test from "node:test";
import assert from "node:assert/strict";
import {roomStatusMessage,roomBadge,roomTelegramMessageAlreadyMatches,roomTerminalMatchesSource} from "../src/services/roomPostStatus.js";

test("Existing ROOM post switches badges without new Telegram messages",()=>{
 const text="🎬 ROOM：夜の交流会\n方式：Jitsi\n状態：準備完了";
 assert.equal(roomStatusMessage(text,"started"),
  "🎬 ROOM：夜の交流会\n方式：Jitsi\n状態：🔴 LIVE中");
 assert.equal(roomStatusMessage(text,"finished"),
  "🎬 ROOM：夜の交流会\n方式：Jitsi\n状態：✅ 終了");
 assert.equal(roomStatusMessage(text,"cancelled"),
  "🎬 ROOM：夜の交流会\n方式：Jitsi\n状態：🚫 中止");
 assert.equal(roomBadge("prepared"),"🟢 準備完了");
});
test("Never show a private meeting URL in an old public ROOM message",()=>{
 assert.throws(()=>roomStatusMessage("🎬 ROOM\nhttps://meet.jit.si/GayBBS-secret","started"),
  /ROOM_PRIVATE_LINK_PUBLIC_REFUSED/);
 assert.throws(()=>roomStatusMessage("","finished"),/INVALID/);
});

test("Room+募集 title and description edit updates original card and preserves status",()=>{
 const original="🎬 ROOM：旧タイトル\n旧説明\n方式：無料Jitsi\n開催：今すぐ\n状態：🔴 LIVE中";
 const edited=roomStatusMessage(original,"details_changed",
  {title:"新タイトル",description:"新しい説明\n2行目"});
 assert.match(edited,/^🎬 ROOM：新タイトル\n新しい説明\n2行目\n方式：無料Jitsi/m);
 assert.match(edited,/状態：🔴 LIVE中/);
 const done=roomStatusMessage(edited,"finished");
 assert.match(done,/新タイトル\n新しい説明/);
 assert.match(done,/状態：✅ 終了/);
 assert.doesNotMatch(done,/旧タイトル|旧説明/);
 assert.throws(()=>roomStatusMessage("旧式カード","details_changed",
  {title:"A",description:"B"}),/ROOM_PUBLIC_CARD_LAYOUT_NOT_VERIFIED/);
});

test("Final Room status can supersede stale LIVE only when source is terminal",()=>{
 assert.equal(roomTerminalMatchesSource("finished","finished"),true);
 assert.equal(roomTerminalMatchesSource("cancelled","cancelled"),true);
 assert.equal(roomTerminalMatchesSource("finished","started"),false);
 assert.equal(roomTerminalMatchesSource("live","finished"),false);
 const oldLive="🎬 ROOM：募集\n方式：Jitsi\n状態：🔴 LIVE中";
 assert.equal(roomStatusMessage(oldLive,"finished"),
  "🎬 ROOM：募集\n方式：Jitsi\n状態：✅ 終了");
});
test("Only Telegram's exact 400 no-change acknowledgement proves idempotence",()=>{
 assert.equal(roomTelegramMessageAlreadyMatches({
  response:{error_code:400,description:"Bad Request: message is not modified"},
 }),true);
 assert.equal(roomTelegramMessageAlreadyMatches({
  response:{error_code:403,description:"Bad Request: message is not modified"},
 }),false);
 assert.equal(roomTelegramMessageAlreadyMatches({
  response:{error_code:400,description:"Bad Request: message to edit not found"},
 }),false);
 assert.equal(roomTelegramMessageAlreadyMatches(new Error("network timeout")),false);
});
