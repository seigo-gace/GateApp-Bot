import test from "node:test";
import assert from "node:assert/strict";
import {roomPublicationEditor,assertRoomDeletionReceipt,completeRoomDeliveryReceipts,canResumeRoomDeliveries,type RoomPublication} from "../src/services/roomPublishedEditor.js";

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
 assert.match(ui.text,/✅ 終了/);
 assert.ok(!ui.keyboard.reply_markup.inline_keyboard.flat().some(b=>b.text.includes("終了する")||b.text.includes("中止する")));
});

test("deletion still accepts immutable sent receipts after destination is disabled",()=>{
 assert.doesNotThrow(()=>assertRoomDeletionReceipt({
  board_key:"area_bbs",purpose:"announcement",
  chat_id:-1003847210571,message_thread_id:116,telegram_message_id:839,
 }));
 assert.doesNotThrow(()=>assertRoomDeletionReceipt({
  board_key:"video_chat",purpose:"room",
  chat_id:-1002373696859,message_thread_id:1605,telegram_message_id:4591,
 }));
});
test("deletion refuses cross-community, invalid topic or fake message receipts",()=>{
 const valid={board_key:"area_bbs",purpose:"announcement",chat_id:-1003847210571,
  message_thread_id:116,telegram_message_id:839};
 for(const invalid of [
  {...valid,chat_id:-1002373696859},
  {...valid,message_thread_id:0},
  {...valid,telegram_message_id:0},
  {...valid,purpose:"profile"},
  {...valid,board_key:"unregistered"},
 ])
  assert.throws(()=>assertRoomDeletionReceipt(invalid),/ROOM_DELETE_TOPIC_STALE/);
});

test("two confirmed receipts restore the existing ROOM DM editor without retransmission",()=>{
 const expected=[101,202];
 assert.equal(completeRoomDeliveryReceipts(expected,[
  {posting_topic_id:101,status:"sent",telegram_message_id:700},
  {posting_topic_id:202,status:"sent",telegram_message_id:701}
 ]),true);
});
test("uncertain, incomplete and duplicate crossposts must never be auto-confirmed",()=>{
 const valid={posting_topic_id:101,status:"sent",telegram_message_id:700};
 for(const receipts of [
  [valid],
  [valid,{posting_topic_id:202,status:"needs_reconcile",telegram_message_id:null}],
  [valid,{posting_topic_id:101,status:"sent",telegram_message_id:701}],
  [valid,{posting_topic_id:999,status:"sent",telegram_message_id:701}],
  [valid,{posting_topic_id:202,status:"sent",telegram_message_id:null}],
 ]) assert.equal(completeRoomDeliveryReceipts([101,202],receipts),false);
});

test("no Telegram attempt or one confirmed destination can resume only missing posts",()=>{
 const expected=[101,202];
 assert.equal(canResumeRoomDeliveries(expected,[]),true);
 assert.equal(canResumeRoomDeliveries(expected,[
  {posting_topic_id:101,status:"sent",telegram_message_id:700}
 ]),true);
 assert.equal(canResumeRoomDeliveries(expected,[
  {posting_topic_id:101,status:"sent",telegram_message_id:700},
  {posting_topic_id:202,status:"pending",telegram_message_id:null},
 ]),true);
});
test("uncertain, in-flight, deleted, unexpected or duplicate receipts never permit retransmission",()=>{
 const valid={posting_topic_id:101,status:"sent",telegram_message_id:700};
 for(const receipts of [
  [valid,{posting_topic_id:202,status:"sending",telegram_message_id:null}],
  [valid,{posting_topic_id:202,status:"needs_reconcile",telegram_message_id:null}],
  [valid,{posting_topic_id:202,status:"deleted",telegram_message_id:701}],
  [valid,{posting_topic_id:202,status:"sent",telegram_message_id:null}],
  [valid,{posting_topic_id:202,status:"pending",telegram_message_id:701}],
  [valid,{posting_topic_id:101,status:"sent",telegram_message_id:701}],
  [valid,{posting_topic_id:999,status:"sent",telegram_message_id:701}],
 ]) assert.equal(canResumeRoomDeliveries([101,202],receipts),false);
 assert.equal(canResumeRoomDeliveries([],[]),false);
});
