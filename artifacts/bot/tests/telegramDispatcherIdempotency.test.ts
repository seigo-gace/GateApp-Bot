import test from "node:test";
import assert from "node:assert/strict";
import type {Telegram} from "telegraf";
import {createTelegramDispatcher} from "../src/services/telegramDispatcher.js";

const target={chatId:-1003770334893,threadId:789};
const body={text:"📝 投稿メニュー\nボタンを選択してください。"};

test("editing an already identical public panel is an idempotent success",async()=>{
 let attempts=0;
 const tg={editMessageText:async()=>{
  attempts++;
  throw new Error("Bad Request: message is not modified");
 }} as unknown as Telegram;
 await assert.doesNotReject(createTelegramDispatcher(tg).revise(target,210,body));
 assert.equal(attempts,1);
});
test("missing or forbidden panel edits remain failed, never silently replaced",async()=>{
 let calls=0;
 const tg={editMessageText:async()=>{
  calls++;
  throw new Error("Bad Request: message to edit not found");
 }} as unknown as Telegram;
 const dispatch=createTelegramDispatcher(tg);
 await assert.rejects(dispatch.revise(target,210,body),/not found/);
 assert.equal(calls,1);
 await assert.rejects(dispatch.revise(target,0,body),/MPB_MESSAGE_ID_INVALID/);
 assert.equal(calls,1);
});
