import test from "node:test";
import assert from "node:assert/strict";
import {roomStageKeyboard,hasExplicitRoomTopicChoice} from "../src/bot/postingHandlers.js";
import {inputInstructions} from "../src/bot/recruitmentHandlers.js";
import {roomRecruitmentSelectorRow} from "../src/services/recruitmentButtonLayout.js";
import {applicationChoiceKeyboard} from "../src/bot/applicationHandlers.js";
import {applicationTagRows} from "../src/services/roomApplicationTags.js";
import {toggleLike} from "../src/services/profileLike.js";
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
test("chosen room method keeps the four-line form and minimal selectable controls",()=>{
 const editing=labels(draft("awaiting_text",{modeSelected:true,externalUrl:null,recruitmentMode:"manual"}));
 assert.deepEqual(editing,[
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
  ["ポジション選択","#Like","#Love"],
  ["▶ 即開始","📅 予告する"],
  ["↩ 戻る","キャンセル"]
 ]);
 const linked=labels(draft("preview",{modeSelected:true,stage:"details",recruitmentMode:"linked",
  title:"テスト",description:"募集内容"}));
 assert.deepEqual(linked,[
  ["#Like","#Love"],
  ["▶ 即開始","📅 予告する"],
  ["↩ 戻る","キャンセル"]
 ]);
 for(const row of [...manual,...linked]){
  for(const text of row){
   assert.ok(!/無料Jitsi|URL持込|応募受付|下書き保存|タイトル・説明を修正|プロフ連携切替|📝 タイトル|📝 ニックネーム|📝 身長|📝 募集内容/.test(text));
  }
 }
});
test("ROOM position panel keeps seven original choices in 3/4 rows without changing navigation",()=>{
 const rows=roomStageKeyboard(draft("preview",{modeSelected:true,stage:"position"})).reply_markup.inline_keyboard;
 assert.deepEqual(rows.map(row=>row.length),[3,4,2]);
 assert.deepEqual(rows.slice(0,2).flat().map(button=>button.text),
  ["タチ","タチリバ","リバ","ウケリバ","ウケ","S","M"]);
 assert.deepEqual(rows.slice(0,2).flat().map(button=>button.callback_data),
  Array.from({length:7},(_,i)=>`room:positionchoice:7:${i}`));
 assert.deepEqual(rows[2]?.map(button=>button.text),["↩ 戻る","キャンセル"]);
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
 assert.equal(style("ポジション選択"),"primary");
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


test("ROOM legacy explicit choice without a saved Topic ID must revalidate the authenticated origin",()=>{
 assert.equal(hasExplicitRoomTopicChoice({destinationExplicit:true}),false);
 assert.equal(hasExplicitRoomTopicChoice({destinationExplicit:true,selectedTopicId:null}),false);
 assert.equal(hasExplicitRoomTopicChoice({destinationExplicit:true,selectedTopicId:0}),false);
 assert.equal(hasExplicitRoomTopicChoice({destinationExplicit:true,selectedTopicId:120.5}),false);
 assert.equal(hasExplicitRoomTopicChoice({destinationExplicit:true,selectedTopicId:"120"}),false);
 assert.equal(hasExplicitRoomTopicChoice({destinationExplicit:true,selectedTopicId:120}),true);
 assert.equal(hasExplicitRoomTopicChoice({destinationExplicit:false,selectedTopicId:120}),false);
});

test("ROOM応募 reuses Room+募集 selectors with its own callbacks",()=>{
 const buttons=roomRecruitmentSelectorRow("manual",false,{
  position:"application:position",
  like:"application:tag:like:open",
  love:"application:tag:love:open"
 });
 assert.deepEqual(buttons.map(b=>b.text),["ポジション選択","#Like","#Love"]);
 assert.deepEqual(buttons.map(b=>b.style),["primary","success","danger"]);
 assert.deepEqual(buttons.map(b=>b.callback_data),
  ["application:position","application:tag:like:open","application:tag:love:open"]);
});

test("応募 starts and previews with the very same Room+募集 selector row and 応募する/キャンセル",()=>{
 const manual=applicationChoiceKeyboard(false,"タチ").reply_markup.inline_keyboard;
 assert.deepEqual(manual.map(row=>row.map(button=>button.text)),[
  ["✅ ポジション","#Like","#Love"],
  ["応募する","キャンセル"]
 ]);
 assert.deepEqual(manual.map(row=>row.map(button=>button.style)),[
  ["primary","success","danger"],["success","danger"]
 ]);
 assert.deepEqual(manual[1]!.map(button=>button.callback_data),
  ["application:confirm","application:cancel"]);
 const linked=applicationChoiceKeyboard(true,"リバ").reply_markup.inline_keyboard;
 assert.deepEqual(linked.map(row=>row.map(button=>button.text)),[
  ["#Like","#Love"],["応募する","キャンセル"]
 ]);
 for(const rows of [manual,linked]){
  assert.ok(rows.flat().every(button=>!button.text.includes("即開始")&&!button.text.includes("予告する")));
 }
});

test("募集+Room is the only source of application #Like/#Love category and tag layouts",()=>{
 const rows=(buttons:readonly (readonly {text:string;style?:string}[])[])=>
  buttons.map(row=>row.map(button=>({text:button.text,style:button.style})));
 for(const purpose of ["like","love"] as const){
  const roomCategories=roomStageKeyboard(draft("preview",{
   modeSelected:true,stage:"tag_categories",tagPurpose:purpose
  })).reply_markup.inline_keyboard;
  const applicantCategories=applicationTagRows(purpose,215,{},undefined);
  assert.deepEqual(rows(applicantCategories),rows(roomCategories));
  const roomTags=roomStageKeyboard(draft("preview",{
   modeSelected:true,stage:"tag_items",tagPurpose:purpose,tagCategory:0,tagPage:0,
   likeTags:[],loveTags:[]
  })).reply_markup.inline_keyboard;
  const applicantTags=applicationTagRows(purpose,215,{},0,0);
  assert.deepEqual(rows(applicantTags),rows(roomTags));
 }
});

test("Room+募集 and ROOM応募 show ✅ on selected #Like/#Love without losing colors",()=>{
 const like=toggleLike([],0,0),love=toggleLike([],1,0);
 const data={modeSelected:true,stage:"details",recruitmentMode:"manual",
  title:"テスト",description:"",position:"タチ",likeTags:like,loveTags:love};
 const room=roomStageKeyboard(draft("preview",data)).reply_markup.inline_keyboard;
 assert.deepEqual(room[0]!.map(button=>button.text),
  ["✅ ポジション","✅ #Like","✅ #Love"]);
 assert.deepEqual(room[0]!.map(button=>button.style),["primary","success","danger"]);
 const none=roomStageKeyboard(draft("preview",{...data,likeTags:[],loveTags:[]})).reply_markup.inline_keyboard;
 assert.deepEqual(none[0]!.map(button=>button.text),
  ["✅ ポジション","#Like","#Love"]);
 const submitted=applicationChoiceKeyboard(false,"タチ",true,true).reply_markup.inline_keyboard;
 assert.deepEqual(submitted[0]!.map(button=>button.text),
  ["✅ ポジション","✅ #Like","✅ #Love"]);
 assert.deepEqual(submitted[0]!.map(button=>button.style),["primary","success","danger"]);
 const onlyLove=applicationChoiceKeyboard(false,undefined,false,true).reply_markup.inline_keyboard;
 assert.deepEqual(onlyLove[0]!.map(button=>button.text),
  ["ポジション選択","#Like","✅ #Love"]);
 const linked=applicationChoiceKeyboard(true,"タチ",true,false).reply_markup.inline_keyboard;
 assert.deepEqual(linked[0]!.map(button=>button.text),["✅ #Like","#Love"]);
});
