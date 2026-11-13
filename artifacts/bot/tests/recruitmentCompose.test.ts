import test from "node:test";
import assert from "node:assert/strict";
import {
 parseRecruitmentMessage,changeRecruitmentField,renderRecruitmentPreview,
 validateRecruitmentReady,validateRecruitmentIdentityReady,recruitmentTextPhase,
} from "../src/services/recruitmentCompose.js";
import {buildRecruitmentRichPreview} from "../src/services/recruitmentRichPreview.js";
import {recruitmentDecisionRow,recruitmentCompactSelectorRows} from "../src/services/recruitmentButtonLayout.js";
import {roomRecruitmentCategoryRows,roomRecruitmentTagRows,roomRecruitmentTagHeading} from "../src/services/roomRecruitmentTagPanels.js";
import {toggleLike} from "../src/services/profileLike.js";

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
 assert.throws(()=>parseRecruitmentMessage("",true));
 assert.throws(()=>parseRecruitmentMessage("タイトル\n名前",false));
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

test("rich owner editor begins with actual group title, topic/post ID, then title and nickname",()=>{
 const d=parseRecruitmentMessage("テスト\nテスト\n170 80 40\n募集内容",false);
 const rich=buildRecruitmentRichPreview(d,7,"エリア’s BBS\n新宿 / 投稿ID：123",undefined,undefined,true);
 const blocks=rich.blocks as Array<{type?:string;text?:unknown}>;
 assert.equal(blocks[0]?.text,"エリア’s BBS");
 assert.equal(blocks[1]?.text,"新宿 / 投稿ID：123");
 assert.match(JSON.stringify(blocks[2]),/テスト/);
 assert.match(JSON.stringify(blocks[3]),/ニックネーム：テスト/);
 assert.doesNotMatch(JSON.stringify(rich),/area_bbs/);
});

test("optional fourth line: manual 3 lines and linked title-only are valid",()=>{
 const manual=parseRecruitmentMessage("題名\nニックネーム\n175 80 40",false);
 assert.equal(manual.body,"");
 assert.equal(manual.nickname,"ニックネーム");
 manual.position="リバ";
 assert.doesNotThrow(()=>validateRecruitmentIdentityReady(manual));
 assert.match(renderRecruitmentPreview(manual),/題名/);
 const blankFourth=parseRecruitmentMessage("題名\nニックネーム\n175 80 40\n",false);
 assert.equal(blankFourth.body,"");
 const linked=parseRecruitmentMessage("題名",true);
 assert.equal(linked.body,"");
 assert.equal(linked.mode,"linked");
 const edited=changeRecruitmentField(manual,"body","");
 assert.equal(edited.body,"");
 assert.equal(edited.title,manual.title);
 // Required identity fields and length checks must remain enforced.
 assert.throws(()=>parseRecruitmentMessage("題名\nニックネーム",false));
 assert.throws(()=>parseRecruitmentMessage("題名\nニックネーム\n170 80 17",false));
 assert.throws(()=>parseRecruitmentMessage("題名\nニックネーム\n175 80 40\n"+("長".repeat(3001)),false));
});

test("相手募集 shares Room first-row selectors, with 目的/場所 only in the second two-column row",()=>{
 const callbacks={position:"recruit:panel:7:position",like:"recruit:panel:7:like",
  love:"recruit:panel:7:love",purpose:"recruit:panel:7:purpose",place:"recruit:panel:7:place"};
 const selected={like:true,love:true,purpose:true,place:false};
 const rows=recruitmentCompactSelectorRows("manual",true,selected,callbacks);
 assert.deepEqual(rows.map(r=>r.length),[3,2]);
 assert.deepEqual(rows[0].map(b=>b.text),["✅ ポジション","✅ #Like","✅ #Love"]);
 assert.deepEqual(rows[0].map(b=>b.style),["primary","success","danger"]);
 assert.deepEqual(rows[1].map(b=>b.text),["✅ 目的","場所"]);
 assert.deepEqual(rows[1].map(b=>b.callback_data),
  ["recruit:panel:7:purpose","recruit:panel:7:place"]);
 assert.deepEqual(rows[1].map(b=>b.style),["primary","primary"]);
 const linked=recruitmentCompactSelectorRows("linked",false,
  {like:false,love:false,purpose:false,place:true},callbacks);
 assert.deepEqual(linked.map(r=>r.length),[2,2]);
 assert.deepEqual(linked[0].map(b=>b.text),["#Like","#Love"]);
 assert.deepEqual(linked[1].map(b=>b.text),["目的","✅ 場所"]);
});
test("相手募集 uses Room Like/Love palette, reusable chooser, and independent tag snapshot",()=>{
 const cb={
  openCategory:(n:number)=>"cat:"+n,
  selectItem:(c:number,n:number)=>"tag:"+c+":"+n,
  changePage:(c:number,n:number)=>"page:"+c+":"+n,
  save:"save",back:"back",cancel:"cancel"
 };
 for(const purpose of ["like","love"] as const){
  const categories=roomRecruitmentCategoryRows(cb,purpose);
  assert.deepEqual(categories.map(row=>row.length),[3,3,2]);
  assert.equal(categories[0][0]?.style,purpose==="like"?"success":"danger");
  assert.match(roomRecruitmentTagHeading(purpose),purpose==="like"?/自分の特徴/:/相手に求める特徴/);
  const choices=roomRecruitmentTagRows(0,0,[],cb,purpose);
  assert(choices.flat().some(b=>b.callback_data==="tag:0:0"));
 }
 const d=parseRecruitmentMessage("募集タイトル\nゼロ\n175 80 40",false);
 const marked={...d,position:"タチ",
  likeTags:[{category:"エロワード",tag:"変態"}],
  loveTags:[{category:"パーツ",tag:"乳首"}],
  purposeCodes:["サシ"],placeCodes:["場所あり"]};
 const text=renderRecruitmentPreview(marked);
 assert.match(text,/#Like：#変態/);
 assert.match(text,/#Love：#乳首/);
 assert.match(text,/目的：#サシ/);
 assert.match(text,/場所：#場所あり/);
 const rich=JSON.stringify(buildRecruitmentRichPreview(marked,7,"エリア's BBS"));
 assert.match(rich,/#Like：#変態/);
 assert.match(rich,/#Love：#乳首/);
 assert.equal(d.likeTags,undefined);
});

test("recruitment Like/Love use the exact profile toggle and never clear unrelated purpose/place values",()=>{
 const base=parseRecruitmentMessage("募集\nゼロ\n170 80 40",false);
 const draft={...base,likeTags:[],loveTags:[],purposeCodes:["サシ"],placeCodes:["場所あり"]};
 const one={...draft,likeTags:toggleLike(draft.likeTags,0,0)};
 assert.equal(one.likeTags.length,1);
 assert.equal(one.loveTags.length,0);
 const two={...one,loveTags:toggleLike(one.loveTags,1,0)};
 assert.equal(two.likeTags.length,1);
 assert.equal(two.loveTags.length,1);
 const three={...two,likeTags:toggleLike(two.likeTags,0,0)};
 assert.deepEqual(three.likeTags,[]);
 assert.equal(three.loveTags.length,1);
 assert.deepEqual(three.purposeCodes,["サシ"]);
 assert.deepEqual(three.placeCodes,["場所あり"]);
});
