import test from "node:test";
import assert from "node:assert/strict";
import {
 parseRecruitmentMessage,changeRecruitmentField,renderRecruitmentPreview,
 validateRecruitmentReady,recruitmentTextPhase,
} from "../src/services/recruitmentCompose.js";
import {buildRecruitmentRichPreview} from "../src/services/recruitmentRichPreview.js";
import {recruitmentDecisionRow} from "../src/services/recruitmentButtonLayout.js";

test("manual recruitment preserves body lines and does not write a profile",()=>{
 const d=parseRecruitmentMessage("今夜の募集\nゼロ\n175 80 40\n集合場所は相談\n時間は夜",false);
 assert.equal(d.mode,"manual");
 assert.equal(d.title,"今夜の募集");
 assert.equal(d.nickname,"ゼロ");
 assert.equal(d.heightCm,175);
 assert.equal(d.weightKg,80);
 assert.equal(d.age,40);
 assert.equal(d.body,"集合場所は相談\n時間は夜");
 assert.deepEqual(d.purposeCodes,[]);
 assert.deepEqual(d.placeCodes,[]);
 assert.match(renderRecruitmentPreview(d),/集合場所は相談\n時間は夜/);
});

test("linked recruitment uses only title and all subsequent body lines",()=>{
 const d=parseRecruitmentMessage("友達募集\n一行目\n二行目",true);
 assert.equal(d.mode,"linked");
 assert.equal(d.body,"一行目\n二行目");
 assert.equal(d.nickname,undefined);
 assert.throws(()=>changeRecruitmentField(d,"nickname","別名"),/PROFILE_LINKED_FIELD_READ_ONLY/);
 assert.throws(()=>validateRecruitmentReady(d),/必須項目/);
});

test("field editing preserves unrelated recruitment fields",()=>{
 const d=parseRecruitmentMessage("募集\nゼロ\n175 80 40\n旧本文",false);
 const e=changeRecruitmentField(d,"body","新本文\nそのまま改行");
 assert.equal(e.body,"新本文\nそのまま改行");
 assert.equal(e.nickname,"ゼロ");
 assert.equal(e.heightCm,175);
 assert.equal(e.title,"募集");
 assert.equal(d.body,"旧本文");
});

test("recruitment input rejects incomplete and unsafe text",()=>{
 assert.throws(()=>parseRecruitmentMessage("タイトルだけ",true));
 assert.throws(()=>parseRecruitmentMessage("タイトル\n名前\n175 80 40",false));
 assert.throws(()=>parseRecruitmentMessage("タイトル\n"+("長".repeat(3001)),true));
 const d=parseRecruitmentMessage("<script>\n本文 & <危険>",true);
 const preview=renderRecruitmentPreview(d,{nickname:"利用者",heightCm:175,weightKg:80,age:40});
 assert.doesNotMatch(preview,/<script>/);
 assert.match(preview,/&lt;script&gt;/);
 assert.match(preview,/&amp;/);
});

test("manual recruitment merges prior tag choices when parsing fresh input",()=>{
 const prior={purposeCodes:["サシ"],placeCodes:["場所あり"]};
 const parsed=parseRecruitmentMessage("テスト\nテスト\n170 80 40\nテスト",false);
 const merged={...parsed,...prior,position:"タチ"};
 assert.deepEqual(merged.purposeCodes,["サシ"]);
 assert.deepEqual(merged.placeCodes,["場所あり"]);
 assert.equal(merged.position,"タチ");
 assert.equal(merged.body,"テスト");
});

test("Master four-line manual input renders into recruitment preview",()=>{
 const d=parseRecruitmentMessage("テスト\nテスト\n170 80 40\nテスト",false);
 assert.equal(d.mode,"manual");
 assert.equal(d.title,"テスト");
 assert.equal(d.nickname,"テスト");
 assert.equal(d.heightCm,170);
 assert.equal(d.weightKg,80);
 assert.equal(d.age,40);
 assert.equal(d.body,"テスト");
 const preview=renderRecruitmentPreview(d);
 assert.match(preview,/📢 <b>テスト<\/b>/);
 assert.match(preview,/ニックネーム：テスト/);
 assert.match(preview,/170cm.*80kg.*40歳/);
 assert.match(preview,/募集内容<\/b>\nテスト/);
 assert.throws(()=>validateRecruitmentReady(d),/ポジション/);
 const trailing=parseRecruitmentMessage("テスト\nテスト\n170 80 40\nテスト\n",false);
 assert.equal(trailing.body,"テスト");
 const multiline=parseRecruitmentMessage("テスト\nテスト\n170 80 40\n上の行\n最終行",false);
 multiline.position="タチ";
 multiline.purposeCodes=["サシ"];
 multiline.placeCodes=["場所あり"];
 const rich=buildRecruitmentRichPreview(multiline,1,"投稿先：未選択");
 const encoded=JSON.stringify(rich);
 assert.match(encoded,/最終行/);
 assert.match(encoded,/タチ/);
 assert.match(encoded,/サシ/);
 assert.match(encoded,/場所あり/);
 assert.match(renderRecruitmentPreview(multiline),/タチ/);
 assert.match(renderRecruitmentPreview(multiline),/最終行/);
 const row=recruitmentDecisionRow(1);
 assert.equal(row.length,2);
 assert.equal(row[0]?.text,"✅ 投稿する");
 assert.equal(row[1]?.text,"キャンセル");
});

test("text entry is accepted after pre-input selector panel, not from preview selector",()=>{
 assert.equal(recruitmentTextPhase("awaiting_text",null),"initial");
 assert.equal(recruitmentTextPhase("awaiting_recruitment_edit",null),"edit");
 assert.equal(recruitmentTextPhase("awaiting_tags","awaiting_text"),"initial");
 assert.equal(recruitmentTextPhase("awaiting_tags","preview"),null);
 assert.equal(recruitmentTextPhase("preview",null),null);
 assert.equal(recruitmentTextPhase("awaiting_tags",null),null);
 const prior={position:"タチ",purposeCodes:["サシ"],placeCodes:["場所あり"]};
 const fresh=parseRecruitmentMessage("テスト\nテスト\n170 80 40\n最終行",false);
 const next={...fresh,...prior,recruitPanel:null,recruitPanelReturnStep:null};
 assert.equal(next.body,"最終行");
 assert.deepEqual(next.purposeCodes,["サシ"]);
 assert.deepEqual(next.placeCodes,["場所あり"]);
 assert.equal(next.position,"タチ");
});
