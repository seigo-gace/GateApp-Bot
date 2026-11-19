import test from "node:test";
import assert from "node:assert/strict";
import { DM_POSTING_MENU_SCREEN_TEXT } from "../src/services/dmPostingMenuRestore.js";
import { bareStartPostingRowLabels } from "../src/services/dmBareStartPostingMenu.js";
import {POSTING_MENU_SCREEN_TEXT} from "../src/services/menuPanelRenderer.js";

test("DM posting menu restore uses the same screen copy as the published panel", () => {
  assert.match(DM_POSTING_MENU_SCREEN_TEXT, /投稿メニュー/);
  assert.equal(DM_POSTING_MENU_SCREEN_TEXT,POSTING_MENU_SCREEN_TEXT);
  const rows = bareStartPostingRowLabels();
  assert.equal(rows.flat().length, 11);
  assert.deepEqual(rows.map((r) => r.length), [3, 2, 2, 3, 1]);
});
