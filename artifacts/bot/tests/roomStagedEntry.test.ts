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
 assert.deepEqual(labels(draft("awaiting_text",{modeSelected:true,externalUrl:null})),
  [["↩ 戻る","キャンセル"]]);
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
