import test from "node:test";
import assert from "node:assert/strict";
import {roomStageKeyboard} from "../src/bot/postingHandlers.js";
import {inputInstructions} from "../src/bot/recruitmentHandlers.js";
import type {EditorDraft} from "../src/services/publicPostRepository.js";

function draft(step:EditorDraft["step"],data:Record<string,unknown>={}):EditorDraft{
 return {module:"room",step,data,revision:7};
}
function labels(d:EditorDraft):string[][]{
 return roomStageKeyboard(d).reply_markup.inline_keyboard.map(row=>row.map(button=>button.text));
}
test("new 募集+Room opens with only room creation and URL choices",()=>{
 assert.deepEqual(labels(draft("preview",{modeSelected:false,visibility:"approved_only"})),
  [["Room作成","Room持ち込み"],["キャンセル"]]);
});
test("chosen room method asks for input before revealing other settings",()=>{
 const editing=labels(draft("awaiting_text",{modeSelected:true,externalUrl:null,recruitmentMode:"manual"}));
 assert.deepEqual(editing,[
  ["📝 タイトル","📝 ニックネーム"],
  ["📝 身長/体重/年齢","📝 募集内容"],
  ["ポジション選択","#Like","#Love"],
  ["▶ 即開始","📅 予告する"],
  ["↩ 戻る","キャンセル"]
 ]);
 assert.deepEqual(labels(draft("awaiting_room_url",{modeSelected:true})),
  [["↩ 戻る","キャンセル"]]);
});
test("settings appear only after required details are available",()=>{
 const d=draft("preview",{modeSelected:true,title:"テスト",description:"募集内容",visibility:"approved_only"});
 const rows=labels(d).flat();
 assert.ok(rows.includes("▶ 即開始"));
 assert.ok(rows.includes("📅 予告する"));
 assert.ok(!rows.includes("ルーム作成"));
 assert.ok(!rows.includes("URL"));
});

test("ROOM's entry guidance uses the complete adopted recruitment input contract",()=>{
 const manual=inputInstructions(false);
 assert.match(manual,/1行目：タイトル/);
 assert.match(manual,/2行目：ニックネーム/);
 assert.match(manual,/3行目：身長 体重 年齢/);
 assert.match(manual,/4行目以降：募集内容/);
 const linked=inputInstructions(true);
 assert.match(linked,/保存済みプロフィールと連動します/);
 assert.match(linked,/2行目以降：募集内容/);
});

test("adopted ROOM editor has exact row layout and excludes every removed legacy button",()=>{
 const manual=labels(draft("preview",{modeSelected:true,stage:"details",recruitmentMode:"manual",
  title:"テスト",description:"募集内容"}));
 assert.deepEqual(manual,[
  ["📝 タイトル","📝 ニックネーム"],
  ["📝 身長/体重/年齢","📝 募集内容"],
  ["ポジション選択","#Like","#Love"],
  ["▶ 即開始","📅 予告する"],
  ["↩ 戻る","キャンセル"]
 ]);
 const linked=labels(draft("preview",{modeSelected:true,stage:"details",recruitmentMode:"linked",
  title:"テスト",description:"募集内容"}));
 assert.deepEqual(linked,[
  ["📝 タイトル","📝 募集内容"],
  ["#Like","#Love"],
  ["▶ 即開始","📅 予告する"],
  ["↩ 戻る","キャンセル"]
 ]);
 for(const row of [...manual,...linked]){
  for(const text of row){
   assert.ok(!/無料Jitsi|URL持込|応募受付|下書き保存|タイトル・説明を修正|プロフ連携切替/.test(text));
  }
 }
});
test("scheduled route uses two participation modes then a separate submit button",()=>{
 assert.deepEqual(labels(draft("preview",{modeSelected:true,stage:"join_choice"})),[
  ["自由参加","承認制"],["↩ 戻る","キャンセル"]]);
 assert.deepEqual(labels(draft("awaiting_datetime",{modeSelected:true,stage:"date_input"})),[
  ["↩ 戻る","キャンセル"]]);
 assert.deepEqual(labels(draft("preview",{modeSelected:true,stage:"scheduled_ready"})),[
  ["✅ 投稿する"],["↩ 戻る","キャンセル"]]);
});

test("ROOM UI uses semantic Telegram styles on actual InlineKeyboard buttons",()=>{
 const rows=roomStageKeyboard(draft("preview",{modeSelected:true,stage:"details",
  recruitmentMode:"manual",title:"テスト",description:"募集内容"})).reply_markup.inline_keyboard;
 const style=(label:string)=>rows.flat().find(x=>x.text===label)?.style;
 assert.equal(style("📝 タイトル"),"primary");
 assert.equal(style("#Like"),"success");
 assert.equal(style("#Love"),"danger");
 assert.equal(style("▶ 即開始"),"success");
 assert.equal(style("📅 予告する"),"primary");
 assert.equal(style("キャンセル"),"danger");
 const first=roomStageKeyboard(draft("preview",{modeSelected:false})).reply_markup.inline_keyboard;
 assert.equal(first[0]?.[0]?.style,"success");
 assert.equal(first[0]?.[1]?.style,"primary");
 assert.equal(first[1]?.[0]?.style,"danger");
 const choices=roomStageKeyboard(draft("preview",{modeSelected:true,stage:"join_choice"})).reply_markup.inline_keyboard;
 assert.equal(choices[0]?.[0]?.style,"success");
 assert.equal(choices[0]?.[1]?.style,"primary");
 const schedule=roomStageKeyboard(draft("preview",{modeSelected:true,stage:"scheduled_ready"})).reply_markup.inline_keyboard;
 assert.equal(schedule[0]?.[0]?.style,"success");
});
