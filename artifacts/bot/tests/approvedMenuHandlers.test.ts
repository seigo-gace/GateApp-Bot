import test from "node:test";
import assert from "node:assert/strict";
import {
  GENERAL_GUIDE_ROWS, POST_MENU_ROWS, HELP_MENU_ROWS,
  generalGuideKeyboard, postingKeyboard, helpKeyboard,
} from "../src/bot/approvedMenuHandlers.js";

test("general guide is shared 6x2 with shortened profile label", () => {
  assert.deepEqual(GENERAL_GUIDE_ROWS.map(row => row.length), [2,2,2,2,2,2]);
  assert.equal(GENERAL_GUIDE_ROWS[3][0], "みんなのプロフ");
  assert.deepEqual(generalGuideKeyboard().map(row => row.length), [2,2,2,2,2,2]);
});

test("posting menu preserves 3-1-2-3 layout, exact labels and paid-video full row", () => {
  assert.deepEqual(POST_MENU_ROWS, [
    ["相手募集", "募集+Room", "告知/予告"],
    ["クリエーター有料ビデオ投稿"],
    ["🔗ボタン作成", "検索/フィルター"],
    ["雑談", "紹介/招待", "操作説明"],
  ]);
  assert.deepEqual(postingKeyboard().map(row => row.length), [3,1,2,3]);
  assert.equal(postingKeyboard()[1][0].callback_data, "tg:post:1:0");
  assert.equal(postingKeyboard()[3][2].callback_data, "tg:post:3:2");
});

test("nested help preserves 3x2 and distinct Room+募集 label", () => {
  assert.deepEqual(HELP_MENU_ROWS, [
    ["プロフ", "Room+募集", "告知/予告"],
    ["🔗ボタン作成", "検索/フィルター", "戻る"],
  ]);
  assert.deepEqual(helpKeyboard().map(row => row.length), [3,3]);
  assert.equal(helpKeyboard()[1][2].callback_data, "tg:help:1:2");
});
