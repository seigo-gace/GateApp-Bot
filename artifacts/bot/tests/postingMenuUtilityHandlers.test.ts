import test from "node:test";
import assert from "node:assert/strict";
import {TALK_TOPICS,copyInviteCell,inviteCopyRows} from "../src/bot/postingMenuUtilityHandlers.js";

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
const routes=[
 {group:"area_bbs",gateStartUrl:"https://t.me/GayBBS_bot?start=online_aaaaaaaaaaaaaaaaaaaaaaaa",verified:true},
 {group:"video_chat",gateStartUrl:"https://t.me/GayBBS_bot?start=online_bbbbbbbbbbbbbbbbbbbbbbbb",verified:true},
 {group:"gay_board",gateStartUrl:"https://t.me/GayBBS_bot?start=online_cccccccccccccccccccccccc",verified:true},
];
test("nonmember receives approved gate copy; verified member receives group link",async()=>{
 const rows=await inviteCopyRows(async chatId=>chatId===-1002373696859,routes);
 assert.equal(rows.length,3);
 assert.match(rows[0]![0]!.text,/承認ゲート/);
 assert.equal(rows[1]![0]!.copy_text.text,"https://t.me/c/2373696859/1");
 assert.match(rows[2]![0]!.text,/承認ゲート/);
 assert.throws(()=>copyInviteCell("bad","https://evil.example/"),/INVITE_LINK_NOT_VERIFIED/);
});
test("missing approved gate fails closed, never copies invented destination",async()=>{
 await assert.rejects(()=>inviteCopyRows(async()=>false,routes.slice(0,2)),/INVITE_GATE_ROUTE_UNVERIFIED/);
});
