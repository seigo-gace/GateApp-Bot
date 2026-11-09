import test from "node:test";
import assert from "node:assert/strict";
import { bareStartPostingRowLabels, navigationButton } from "../src/services/dmBareStartPostingMenu.js";
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
  assert.deepEqual(missing, {text:"雑談", callback_data:"dm:nav-unavailable", hide:false});
  const verified = navigationButton("雑談", "https://t.me/example_verified");
  assert.equal(verified.text, "雑談");
  assert.equal(verified.url, "https://t.me/example_verified");
});
