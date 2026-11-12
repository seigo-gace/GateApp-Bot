import test from "node:test";
import assert from "node:assert/strict";
import {helpHomeKeyboard,helpSectionKeyboard} from "../src/bot/operationHelpHandlers.js";
import {APPROVED_HELP_ROWS} from "../src/services/menuPanelRenderer.js";
test("operation help always uses approved 3x2 button layout",()=>{
 const k=helpHomeKeyboard(15).reply_markup.inline_keyboard;
 assert.deepEqual(k.map(r=>r.map(b=>b.text)),APPROVED_HELP_ROWS.map(x=>[...x]));
 assert.deepEqual(k.map(r=>r.length),[3,3]);
 assert.equal(k[1][2].callback_data,"help:back:15");
 assert.equal(k[0][0].callback_data,"help:topic:15:profile");
 assert.equal(k[0][1].callback_data,"help:topic:15:room");
 assert.equal(k[1][0].callback_data,"help:topic:15:link");
});
test("help section opens only owned existing editor and returns to guide",()=>{
 for(const feature of ["profile","room","announcement","link","search"] as const){
  const rows=helpSectionKeyboard(5,feature).reply_markup.inline_keyboard;
  assert.deepEqual(rows.map(r=>r.length),[1,1]);
  assert.equal(rows[0][0].callback_data,"help:open:5:"+feature);
  assert.equal(rows[1][0].callback_data,"help:home:5");
 }
});

test("Room+募集 remains one integrated editor, not two invented paths",()=>{
 const rows=helpSectionKeyboard(9,"room").reply_markup.inline_keyboard;
 assert.deepEqual(rows.map(r=>r.map(x=>x.text)),[
  ["▶ この機能を開く"],["↩ 操作説明へ戻る"]]);
 assert.equal(rows[0][0].callback_data,"help:open:9:room");
});
