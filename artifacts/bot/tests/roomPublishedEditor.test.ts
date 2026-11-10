import test from "node:test";
import assert from "node:assert/strict";
import {roomPublicationEditor,type RoomPublication} from "../src/services/roomPublishedEditor.js";

const room=(status:string):RoomPublication=>({
 announcementId:57,roomId:31,roomRevision:4,groupTitle:"エリア’s BBS",
 topicTitle:"新宿",chatId:-1003847210571,messageId:839,
 title:"テストROOM",description:"参加者を募集しています",status,
 visibility:"approved_only",scheduledAt:null,
 ownerJoinUrl:"https://meet.jit.si/GACE-TEST-ROOM",
});
test("published Room+募集 retains owner manager and correct public group/topic, not raw IDs",()=>{
 const ui=roomPublicationEditor(room("live"));
 assert.ok(ui.text.startsWith("エリア’s BBS\n新宿 / 投稿ID：57\n🎬 テストROOM"));
 assert.match(ui.text,/募集内容\n参加者を募集しています/);
 assert.doesNotMatch(ui.text,/area_bbs|chat_id|thread_id|join_url/);
 const buttons=ui.keyboard.reply_markup.inline_keyboard.flat();
 assert.ok(buttons.some(x=>x.text.includes("編集")));
 assert.ok(buttons.some(x=>x.text.includes("終了")));
 assert.ok(buttons.some(x=>"url" in x&&x.url==="https://meet.jit.si/GACE-TEST-ROOM"));
 assert.doesNotMatch(ui.text,/meet\.jit\.si/);
 assert.ok(buttons.some(x=>"url" in x&&x.url==="https://t.me/c/3847210571/839"));
});
test("scheduled Room+募集 has cancellation but no direct join URL or live-end action",()=>{
 const ui=roomPublicationEditor({...room("scheduled"),scheduledAt:"2026-11-20T11:00:00.000Z"});
 assert.match(ui.text,/📅 予告中/);
 assert.match(ui.text,/日本時間/);
 assert.ok(ui.keyboard.reply_markup.inline_keyboard.flat().some(b=>b.text.includes("削除")));
 assert.ok(!ui.keyboard.reply_markup.inline_keyboard.flat().some(x=>"url" in x&&x.url?.includes("meet.jit.si")));
});
test("finished Room+募集 stays listed but cannot be edited through meeting actions",()=>{
 const ui=roomPublicationEditor(room("finished"));
 assert.match(ui.text,/⚫ 終了/);
 assert.ok(!ui.keyboard.reply_markup.inline_keyboard.flat().some(b=>b.text.includes("終了する")||b.text.includes("中止する")));
});
