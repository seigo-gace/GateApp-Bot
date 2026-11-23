import test from "node:test";
import assert from "node:assert/strict";
import {sectionText,helpHomeKeyboard,helpSectionKeyboard} from "../src/bot/operationHelpHandlers.js";
import {APPROVED_HELP_ROWS} from "../src/services/menuPanelRenderer.js";

test("every help topic describes purpose, effects and real operations before opening feature",()=>{
 const topics=["profile","room","announcement","link","search"] as const;
 for(const topic of topics){
  const text=sectionText[topic];
  assert.match(text,/【どんな機能？】/);
  assert.match(text,/【具体的な操作】/);
  for(const step of ["①","②","③","④"])assert.ok(text.includes(step),topic+" "+step);
  const buttons=helpSectionKeyboard(9,topic).reply_markup.inline_keyboard;
  assert.equal(buttons[0]?.[0]?.callback_data,"help:open:9:"+topic);
  assert.equal(buttons[1]?.[0]?.callback_data,"help:home:9");
 }
});
test("help keeps adopted 3 by 2 layout, not old profile/commands/URLs",()=>{
 const rows=helpHomeKeyboard(5).reply_markup.inline_keyboard;
 assert.deepEqual(rows.map(row=>row.map(b=>b.text)),APPROVED_HELP_ROWS);
 assert.deepEqual(rows.map(row=>row.length),[3,3]);
 for(const row of rows)for(const b of row){
  assert.ok(b.callback_data?.startsWith("help:"));
  assert.equal(b.url,undefined);
 }
 const profile=sectionText.profile;
 assert.match(profile,/自己紹介/);
 assert.match(profile,/3掲示板/);
 assert.match(profile,/ポジション/);
 assert.match(profile,/アルバム/);
 assert.match(profile,/保存・3掲示板へ投稿/);
 assert.doesNotMatch(profile,/下の7つのボタン|1〜3列|表示名 \| https/);
 const link=sectionText.link;
 assert.match(link,/1行目/);
 assert.match(link,/2行/);
 assert.match(link,/［▶］/);
 assert.match(link,/［▼］/);
 assert.match(link,/［ボタンの追加］|［編集］/);
 assert.doesNotMatch(link,/表示名 \| https/);
});
test("room and announcement descriptions follow current stage and publication choices",()=>{
 assert.match(sectionText.room,/Room作成/);
 assert.match(sectionText.room,/Room持ち込み/);
 assert.match(sectionText.room,/即開始/);
 assert.match(sectionText.room,/予告する/);
 assert.match(sectionText.room,/自由参加/);
 assert.match(sectionText.room,/承認制/);
 assert.match(sectionText.announcement,/下書き保存/);
 assert.match(sectionText.announcement,/投稿先/);
 assert.match(sectionText.search,/5件ずつ/);
 assert.match(sectionText.search,/#Like/);
 assert.match(sectionText.search,/#Love/);
});
