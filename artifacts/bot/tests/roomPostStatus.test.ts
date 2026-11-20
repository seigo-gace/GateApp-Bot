import test from "node:test";
import assert from "node:assert/strict";
import {roomStatusMessage,roomBadge} from "../src/services/roomPostStatus.js";

test("Existing ROOM post switches badges without new Telegram messages",()=>{
 const text="🎬 ROOM：夜の交流会\n方式：Jitsi\n状態：準備完了";
 assert.equal(roomStatusMessage(text,"started"),
  "🎬 ROOM：夜の交流会\n方式：Jitsi\n状態：🔴 LIVE中");
 assert.equal(roomStatusMessage(text,"finished"),
  "🎬 ROOM：夜の交流会\n方式：Jitsi\n状態：✅ 終了");
 assert.equal(roomStatusMessage(text,"cancelled"),
  "🎬 ROOM：夜の交流会\n方式：Jitsi\n状態：🚫 中止");
 assert.equal(roomBadge("prepared"),"🟢 準備完了");
 assert.equal(roomBadge("scheduled"),"📅 予告中");
});
test("Never show a private meeting URL in an old public ROOM message",()=>{
 assert.throws(()=>roomStatusMessage("🎬 ROOM\nhttps://meet.jit.si/GayBBS-secret","started"),
  /ROOM_PRIVATE_LINK_PUBLIC_REFUSED/);
 assert.throws(()=>roomStatusMessage("","finished"),/INVALID/);
});
