import test from "node:test";
import assert from "node:assert/strict";
import {Markup} from "telegraf";
import {
 TELEGRAM_CLIENT_TARGETS,TELEGRAM_CLIENT_ACCEPTANCE,
 TELEGRAM_ENTRY_TRANSPORT,assertTelegramInlineKeyboard,
 assertTelegramInlineButton
} from "../src/services/telegramClientCompatibility.js";
test("same verified Bot API transport applies to all five OS targets without assuming device identity",()=>{
 assert.deepEqual([...TELEGRAM_CLIENT_TARGETS],["ios","ipados","android","windows","macos"]);
 assert.ok(TELEGRAM_CLIENT_TARGETS.every(x=>TELEGRAM_CLIENT_ACCEPTANCE[x]==="NOT_VERIFIED"));
 assert.equal(TELEGRAM_ENTRY_TRANSPORT.public_to_dm,"deep_link");
 assert.equal(TELEGRAM_ENTRY_TRANSPORT.dm_internal,"callback_query");
});
test("common validator preserves exact labels, rows and styles",()=>{
 const keyboard=Markup.inlineKeyboard([
  [{text:"相手募集",callback_data:"dm:recruit",style:"success"}],
  [{text:"雑談",url:"https://t.me/GayBBS_bot?start=talk",style:"primary"}],
  [{text:"紹介/招待",copy_text:{text:"https://t.me/GayBBS_bot?start=gate_example"}}],
 ]);
 const snapshot=JSON.stringify(keyboard);
 assert.doesNotThrow(()=>assertTelegramInlineKeyboard(keyboard));
 assert.equal(JSON.stringify(keyboard),snapshot);
});
test("cross-client callback payload has Telegram 64 UTF-8 byte limit",()=>{
 assert.doesNotThrow(()=>assertTelegramInlineButton({text:"操作",callback_data:"a".repeat(64)}));
 assert.throws(()=>assertTelegramInlineButton({text:"操作",callback_data:"あ".repeat(22)}),/CALLBACK_BYTES/);
});
test("buttons cannot combine URL and callbacks or have an empty copy payload",()=>{
 assert.throws(()=>assertTelegramInlineButton({text:"移動",url:"https://t.me/test",callback_data:"x"}),/ACTION_AMBIGUOUS/);
 assert.throws(()=>assertTelegramInlineButton({text:"コピー",copy_text:{text:""}}),/COPY_TEXT_INVALID/);
 assert.doesNotThrow(()=>assertTelegramInlineButton({text:"コピー",copy_text:{text:"あ".repeat(256)}}));
 assert.throws(()=>assertTelegramInlineButton({text:"コピー",copy_text:{text:"あ".repeat(257)}}),/COPY_TEXT_INVALID/);
 assert.throws(()=>assertTelegramInlineKeyboard({reply_markup:{inline_keyboard:[[]]}}),/EMPTY_ROW/);
});
