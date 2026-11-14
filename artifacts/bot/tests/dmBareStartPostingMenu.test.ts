import test from "node:test";
import assert from "node:assert/strict";
import { bareStartPostingRowLabels, navigationButton, canOpenPostingEditor, CHAT_TOPIC_CHOICES, chatTopicSelectionExtra } from "../src/services/dmBareStartPostingMenu.js";
import { APPROVED_POSTING_ROWS } from "../src/services/menuPanelRenderer.js";

test("bare /start posting menu uses Master 3/2/2/3 rows", () => {
  const rows = bareStartPostingRowLabels();
  assert.deepEqual(rows, APPROVED_POSTING_ROWS.map((r) => [...r]));
  assert.equal(rows.flat().length, 10);
  assert.deepEqual(rows.map((r) => r.length), [3, 2, 2, 3]);
  assert.deepEqual(rows[1], ["プロフ作成", "クリエーター有料ビデオ投稿"]);
});


test("missing verified navigation URL does not crash the DM menu or create an unverified link", () => {
  const missing = navigationButton("雑談");
  assert.equal(missing.text, "雑談");
  assert.equal("callback_data" in missing && missing.callback_data, "dm:nav-unavailable");
  const verified = navigationButton("雑談", "https://t.me/example_verified");
  assert.equal(verified.text, "雑談");
  assert.equal("url" in verified && verified.url, "https://t.me/example_verified");
});


test("recruitment and profile editors open without granting Telegram publication", () => {
  assert.equal(canOpenPostingEditor("相手募集", false), true);
  assert.equal(canOpenPostingEditor("相手募集", true), true);
  assert.equal(canOpenPostingEditor("プロフ作成", false), true);
  assert.equal(canOpenPostingEditor("プロフ作成", true), true);
  assert.equal(canOpenPostingEditor("検索/フィルター", false), true);
  assert.equal(canOpenPostingEditor("検索/フィルター", true), true);
  assert.equal(canOpenPostingEditor("告知/予告", false), false);
  assert.equal(canOpenPostingEditor("告知/予告", true), true);
  assert.equal(canOpenPostingEditor("募集+Room", false), false);
});

test("talk selection shows exactly three Master-supplied group links with a back action", () => {
  assert.deepEqual(CHAT_TOPIC_CHOICES.map(x=>x.url), [
    "https://t.me/c/2373696859/4291",
    "https://t.me/c/3847210571/44",
    "https://t.me/c/3770334893/789",
  ]);
  const keyboard=chatTopicSelectionExtra().reply_markup.inline_keyboard;
  assert.deepEqual(keyboard.slice(0,3).map(row=>row[0]?.text),CHAT_TOPIC_CHOICES.map(x=>x.label));
  assert.deepEqual(keyboard.slice(0,3).map(row=>("url" in row[0]! ? row[0]!.url : null)),
    CHAT_TOPIC_CHOICES.map(x=>x.url));
  assert.equal(keyboard[3]?.[0]?.text, "🔙 戻る");
  assert.equal("callback_data" in keyboard[3]![0]! && keyboard[3]![0]!.callback_data, "dm:chat-back");
});
