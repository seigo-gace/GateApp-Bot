import test from "node:test";
import assert from "node:assert/strict";
import {TALK_TOPICS,copyInviteCell,commonInviteCopyRows} from "../src/bot/postingMenuUtilityHandlers.js";

test("talk selector points only to three Master-verified topic links",()=>{
 assert.deepEqual(TALK_TOPICS.map(x=>x.url),[
  "https://t.me/c/3847210571/44",
  "https://t.me/c/2373696859/4291",
  "https://t.me/c/3770334893/789",
 ]);
 assert.equal(new Set(TALK_TOPICS.map(x=>x.url)).size,3);
});
test("Telegram copy_text is real clipboard action, not URL navigation",()=>{
 const cell=copyInviteCell("📋 承認ゲート","https://t.me/GayBBS_bot?start=online_abcdefghijklmnopqrstuvwx");
 assert.equal(cell.copy_text.text,"https://t.me/GayBBS_bot?start=online_abcdefghijklmnopqrstuvwx");
 assert.equal("url" in cell,false);
 assert.throws(()=>copyInviteCell("fake","http://invalid.example"),/INVITE_LINK_NOT_VERIFIED/);
});
test("common Gate is copied once and chooser remains owned by existing Gate",()=>{
 const url="https://t.me/GayBBS_bot?start=gate_shared01";
 const rows=commonInviteCopyRows(url);
 assert.equal(rows.length,1);
 assert.equal(rows[0]![0]!.copy_text.text,url);
 assert.equal(rows[0]![0]!.text,"📋 共通参加承認ゲートをコピー");
 assert.equal("url" in rows[0]![0]!,false);
});
