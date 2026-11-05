import test from "node:test";
import assert from "node:assert/strict";
import {parseRecruitmentMessage,changeRecruitmentField,renderRecruitmentPreview,validateRecruitmentReady} from "../src/services/recruitmentCompose.js";
import {buildRecruitmentRichPreview} from "../src/services/recruitmentRichPreview.js";

test("new recruitment without saved profile uses first three lines, keeps multiline tail",()=>{
 const value=parseRecruitmentMessage("今夜募集\nゼロ\n175 80 40\n1行目\n\n3行目",false);
 assert.equal(value.title,"今夜募集");
 assert.equal(value.nickname,"ゼロ");
 assert.equal(value.heightCm,175);
 assert.equal(value.body,"1行目\n\n3行目");
 assert.equal(value.mode,"manual");
 const edited=changeRecruitmentField(value,"title","別のタイトル");
 assert.equal(edited.body,value.body);
 assert.equal(changeRecruitmentField(value,"body","新本文\n2行目").nickname,"ゼロ");
 assert.equal(changeRecruitmentField(value,"stats","180 75 41").age,41);
 assert.throws(()=>changeRecruitmentField(value,"stats","999 75 41"));
 assert.throws(()=>validateRecruitmentReady(value),/ポジション/);
});
test("saved-profile recruitment uses only title and remaining full body, never overwrites profile",()=>{
 const value=parseRecruitmentMessage("募集タイトル\n本文冒頭\n\n本文続き",true);
 assert.equal(value.mode,"linked");assert.equal(value.body,"本文冒頭\n\n本文続き");
 assert.equal(value.nickname,undefined);
 assert.throws(()=>changeRecruitmentField(value,"nickname","変更禁止"),/READ_ONLY/);
 assert.throws(()=>validateRecruitmentReady(value),/保存済みプロフィール/);
 assert.match(renderRecruitmentPreview(value,{nickname:"ゼロ",heightCm:175,weightKg:80,age:40,position:"リバ"}),/本文続き/);
});
test("HTML escaping and short/incomplete input guard",()=>{
 const v=parseRecruitmentMessage("<title>\n投稿内容 <script>\n二行目",true);
 assert.match(renderRecruitmentPreview(v,{nickname:"x",heightCm:175,weightKg:80,age:40,position:"タチ"}),/&lt;title&gt;/);
 assert.doesNotMatch(renderRecruitmentPreview(v,{nickname:"x",heightCm:175,weightKg:80,age:40,position:"タチ"}),/<script>/);
 for(const s of ["タイトルのみ","\n本文","タイトル\n"])assert.throws(()=>parseRecruitmentMessage(s,true));
 assert.throws(()=>parseRecruitmentMessage("タイトル\n名前\n175 80 40",false));
});

test("Telegram 10.3 rich preview puts editing callbacks right beside each section",()=>{
 const d=parseRecruitmentMessage("募集タイトル\nゼロ\n175 80 40\n本文1行\n本文2行",false);
 const rich=buildRecruitmentRichPreview(d,7,"投稿先：確認済み");
 const blocks=rich.blocks as any[];
 const inline=blocks.flatMap(b=>Array.isArray(b.text)?b.text:[]).filter(
  b=>b?.type==="button").map(x=>x.button.callback_data);
 assert.deepEqual(inline,[
  "recruit:edit:7:title","recruit:edit:7:nickname",
  "recruit:edit:7:stats","recruit:edit:7:body",
 ]);
 assert.equal(blocks.some(b=>b.text==="本文1行\n本文2行"),true);
 const linked=parseRecruitmentMessage("タイトル\n本文",true);
 const linkedButtons=(buildRecruitmentRichPreview(linked,9,"投稿先：確認済み").blocks as any[])
  .flatMap(b=>Array.isArray(b.text)?b.text:[])
  .filter(x=>x?.type==="button").map(x=>x.button.callback_data);
 assert.deepEqual(linkedButtons,["recruit:edit:9:title","recruit:edit:9:body"]);
});
