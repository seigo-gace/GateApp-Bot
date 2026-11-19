import test from "node:test";
import assert from "node:assert/strict";
import {normalizeBugReport,bugReportPreview,bugReportInputErrorText} from "../src/bot/bugReportHandlers.js";
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

test("report receipt contains submitted text and concise apology without operator identity",()=>{
 const preview=bugReportPreview("投稿を押しても反応しない");
 assert.match(preview,/【報告内容】\n投稿を押しても反応しない/);
 assert.match(preview,/申し訳ありません/);
 assert.match(preview,/ご報告ありがとうございます/);
 assert.match(preview,/改善に努めます/);
 assert.equal(preview.includes("Userbot"),false);
 assert.equal(preview.includes("［報告をする］"),false);
});

test("report preview renders actual line breaks, never literal escaped newlines",()=>{
 const preview=bugReportPreview("送信できない");
 assert.ok(preview.includes("\n\n【報告内容】\n"));
 assert.equal(preview.includes(String.raw`\n`),false);
});

test("bug report completion uses separate receipt and a fresh posting menu",()=>{
 // Integration tests inspect actual Telegram calls; prevent UI regression at source level.
 assert.equal(bugReportPreview("テスト").includes("投稿メニュー"),false);
 assert.equal(bugReportPreview("テスト").includes("↩"),false);
});

test("invalid report input reuses the pending wizard with real line breaks and deletion failure advice",()=>{
 const deleted=bugReportInputErrorText(true);
 const failed=bugReportInputErrorText(false);
 assert.ok(deleted.includes("🐞 不具合を報告\n\n下の入力欄"));
 assert.ok(deleted.includes("\n\n報告内容を1〜2000文字で入力してください。"));
 assert.equal(deleted.includes("手動で削除してください。"),false);
 assert.ok(failed.includes("手動で削除してください。"));
 assert.equal(failed.includes(String.raw`\n`),false);
});
