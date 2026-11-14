import test from "node:test";
import assert from "node:assert/strict";
import {normalizeBugReport} from "../src/bot/bugReportHandlers.js";
import {APPROVED_POSTING_ROWS,postingButtonStyle} from "../src/services/menuPanelRenderer.js";

test("bug report button is the sole last row; prior ten retain positions",()=>{
 assert.deepEqual(APPROVED_POSTING_ROWS.map(row=>row.length),[3,2,2,3,1]);
 assert.deepEqual(APPROVED_POSTING_ROWS[4],["🐞 不具合を報告"]);
 assert.equal(APPROVED_POSTING_ROWS.slice(0,4).flat().length,10);
 assert.equal(postingButtonStyle("🐞 不具合を報告"),"danger");
});
test("bug report normalizes text and blocks blank/oversize/command submissions",()=>{
 assert.equal(normalizeBugReport("  投稿できない  "),"投稿できない");
 assert.equal(normalizeBugReport("   "),null);
 assert.equal(normalizeBugReport("/start"),null);
 assert.equal(normalizeBugReport("a".repeat(2000))?.length,2000);
 assert.equal(normalizeBugReport("a".repeat(2001)),null);
});
