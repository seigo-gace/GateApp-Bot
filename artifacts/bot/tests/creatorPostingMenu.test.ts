import test from "node:test";
import assert from "node:assert/strict";
import {CREATOR_DESTINATIONS,CREATOR_POSTING_TEXT,creatorPostingKeyboard} from "../src/services/creatorPostingMenu.js";
import {APPROVED_POSTING_ROWS} from "../src/services/menuPanelRenderer.js";

test("GayBBS retains 3/2/2/3 posting menu with renamed creator entry",()=>{
 assert.deepEqual(APPROVED_POSTING_ROWS.map(row=>row.length),[3,2,2,3]);
 assert.deepEqual(APPROVED_POSTING_ROWS[1],["プロフ作成","クリエーター用投稿"]);
});

test("creator launcher has exactly two CreateVdobot responsibilities and Back",()=>{
 assert.deepEqual(CREATOR_DESTINATIONS,{
  video:"https://t.me/CreateVdobot?start=video",
  sticker:"https://t.me/CreateVdobot?start=sticker"
 });
 const rows=creatorPostingKeyboard().reply_markup.inline_keyboard;
 assert.deepEqual(rows.map(row=>row.map(button=>button.text)),[
  ["動画","ステッカー/絵文字"],["🔙 戻る"]]);
 assert.deepEqual(rows[0]?.map(b=>"url" in b?b.url:null),[
  CREATOR_DESTINATIONS.video,CREATOR_DESTINATIONS.sticker
 ]);
 assert.equal("callback_data" in rows[1]![0]!&&rows[1]![0]!.callback_data,"dm:chat-back");
 assert.doesNotMatch(CREATOR_POSTING_TEXT,/販売が完了|出金できます/);
});
