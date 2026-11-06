import test from "node:test";
import assert from "node:assert/strict";
import {PROFILE_OVERVIEW_ROWS,profileOverviewButtons} from "../src/services/profileOverviewLayout.js";

test("approved profile overview A has 3/3/2 with exact labels and no filler",()=>{
 const labels=PROFILE_OVERVIEW_ROWS.map(row=>row.map(item=>item.label));
 assert.deepEqual(labels,[
  ["基本情報","容姿/エリア","🖼️画像🎬動画/自己PR"],
  ["#Like","#Love","プレビュー"],
  ["保存","キャンセル"],
 ]);
 assert.deepEqual(labels.map(row=>row.length),[3,3,2]);
 assert.equal(new Set(labels.flat()).size,8);
});
test("every profile overview action is a private callback and never a chat text",()=>{
 const rows=profileOverviewButtons(14);
 assert.deepEqual(rows.map(row=>row.length),[3,3,2]);
 assert.ok(rows.flat().every(b=>b.callback_data.startsWith("pf:overview:14:")));
 assert.ok(rows.flat().every(b=>Buffer.byteLength(b.callback_data,"utf8")<=64));
 assert.throws(()=>profileOverviewButtons(0),/REVISION/);
});
