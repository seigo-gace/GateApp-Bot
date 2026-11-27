import test from "node:test";
import assert from "node:assert/strict";
import {noticeParts,noticeText,noticeEdit,noticeJoin,noticeMedia,
 validateNotice,noticeCard,buildNoticeRichPreview} from "../src/services/noticeEditor.js";
import {announcementPanel,announcementSummary} from "../src/bot/postingHandlers.js";

test("general notice edits title/body individually without resetting related fields",()=>{
 const draft={kind:"announcement",title:"旧タイトル",body:"旧本文",text:"旧タイトル\n旧本文",
  participation:"public",deadlineAt:"2030-01-01T00:00:00.000Z",
  linkLabel:"参加詳細",linkUrl:"https://example.com/entry"};
 const title=noticeEdit(draft,"title","新タイトル");
 assert.deepEqual(noticeParts(title),{title:"新タイトル",body:"旧本文"});
 const body=noticeEdit(title,"body","1行目\n2行目");
 assert.equal(noticeText(body),"新タイトル\n1行目\n2行目");
 assert.equal(body.participation,"public");
 assert.equal(body.deadlineAt,draft.deadlineAt);
 assert.equal(body.linkUrl,draft.linkUrl);
});
test("single link button requires name and public HTTPS URL",()=>{
 const a=noticeEdit({kind:"announcement"},"link","詳細を見る\nhttps://example.com/a");
 assert.equal(a.linkLabel,"詳細を見る");
 assert.equal(a.linkUrl,"https://example.com/a");
 assert.throws(()=>noticeEdit({},"link","詳細\nhttp://example.com"));
 assert.throws(()=>noticeEdit({},"link","詳細だけ"));
 assert.equal(noticeEdit(a,"link","なし").linkUrl,null);
});
test("Room-style JST deadline can be set and cleared on a general notice",()=>{
 const d=noticeEdit({},"deadline","2030/01/01 20:00");
 assert.equal(d.deadlineAt,"2030-01-01T11:00:00.000Z");
 assert.equal(noticeEdit(d,"deadline","なし").deadlineAt,null);
});
test("free join/approved join and media file references persist in the same private draft",()=>{
 assert.equal(noticeJoin({participation:"public"}),"public");
 assert.equal(noticeJoin({participation:"approved_only"}),"approved_only");
 assert.equal(noticeJoin({}),"none");
 assert.deepEqual(noticeMedia({media:[{kind:"photo",fileId:"photo_1"},
  {kind:"video",fileId:"video_2"}]}),[{kind:"photo",fileId:"photo_1"},
  {kind:"video",fileId:"video_2"}]);
});
test("empty notice is rejected and configured public card fields render",()=>{
 assert.throws(()=>validateNotice({kind:"announcement"},1));
 const data={kind:"announcement",title:"題名",body:"本文",text:"題名\n本文",
  participation:"public",deadlineAt:"2030-01-01T11:00:00.000Z"};
 validateNotice(data,1);
 assert.match(noticeCard(data,1),/題名/);
 assert.match(noticeCard(data,1),/受付終了/);
});
test("approved notice preview shows only requested eight controls and correct callback routes",()=>{
 const d={module:"announcement",step:"preview",revision:7,
  data:{kind:"announcement",title:"題名",body:"本文",text:"題名\n本文",participation:"none"}} as const;
 const rows=announcementPanel(d).reply_markup.inline_keyboard;
 assert.deepEqual(rows.map(row=>row.map(x=>x.text)),[
  ["日時設定","期限設定","参加方法"],
  ["画像/動画変更","🔗ボタン","下書き保存"],
  ["投稿する","キャンセル"]
 ]);
 assert.equal(rows.flat().find(x=>x.text==="参加方法")?.callback_data,"post:announce:joinmenu:7");
 assert.equal(rows.flat().find(x=>x.text==="投稿する")?.callback_data,"post:announce:publish:7");
 assert.ok(!rows.flat().some(x=>/プロフ連携|投稿先/.test(x.text)));
 const preview=announcementSummary(d);
 assert.match(preview,/タイトル：題名/);
 assert.match(preview,/説明：本文/);
 assert.doesNotMatch(preview,/\/start|[?&]start=|［編集］|<a\b/);
 const rich=buildNoticeRichPreview(d.data,d.revision);
 assert.deepEqual(rich.blocks,[
  {type:"paragraph",text:"📢 告知/予告"},
  {type:"paragraph",text:[{type:"button",button:{text:"［編集］",style:"link",callback_data:"post:announce:title:7"}}," タイトル：題名"]},
  {type:"paragraph",text:[{type:"button",button:{text:"［編集］",style:"link",callback_data:"post:announce:body:7"}}," 説明：本文"]},
  {type:"paragraph",text:"開催日時：［未設定］"},
  {type:"paragraph",text:"受付期限：［未設定］"},
  {type:"paragraph",text:"参加方法：［未設定］"}
 ]);
 assert.doesNotMatch(JSON.stringify(rich),/\/start|[?&]start=|ne_[tb]_|"url":/);
 assert.match(preview,/開催日時：［未設定］/);
 assert.match(preview,/受付期限：［未設定］/);
 assert.match(preview,/参加方法：［未設定］/);
 assert.ok(!preview.includes("プロフ連携"));
 assert.ok(!preview.includes("投稿先"));
});
test("media-only notice can be submitted without title or explanation",()=>{
 const data={kind:"announcement",media:[{kind:"photo",fileId:"photo_1"}]};
 validateNotice(data,1);
 assert.equal(noticeText(data),"");
 assert.equal(noticeCard(data,1),"📢 告知");
 const preview=announcementSummary({module:"announcement",step:"preview",revision:8,data});
 assert.match(preview,/タイトル：［未設定］/);
 assert.match(preview,/説明：［未設定］/);
 assert.equal(preview.includes("［編集］"),false);
});
test("public announcement omits unset options",()=>{
 const text=noticeCard({kind:"announcement",title:"告知",body:"本文",participation:"none"},1);
 assert.ok(!text.includes("開催："));
 assert.ok(!text.includes("受付終了："));
 assert.ok(!text.includes("未設定"));
 assert.ok(!text.includes("参加方法"));
 assert.ok(!text.includes("［編集］"));
});

// Static wiring regression: callback action and keyboard entry must remain paired.
test("notice date picker supports explicit removal of both optional dates",async()=>{
 const {readFileSync}=await import("node:fs");
 const source=readFileSync(new URL("../src/bot/postingHandlers.ts",import.meta.url),"utf8");
 assert.match(source,/post:announce:dt:clear:\$\{rev\}/);
 assert.match(source,/hour\|minute\|manual\|clear/);
 assert.match(source,/data\.noticeDateField==="deadline"\?"deadlineAt":"eventAt"\]:null/);
 assert.match(source,/noticePickerStage:null,noticeDateField:null/);
});

test("notice publish uses selected destination and never loops to picker",async()=>{
 const {readFileSync}=await import("node:fs");
 const source=readFileSync(new URL("../src/bot/postingHandlers.ts",import.meta.url),"utf8");
 const branch=source.slice(source.indexOf('}else if(op==="destination"||op==="publish"){'));
 assert.ok(branch.startsWith('}else if(op==="destination"||op==="publish"){'));
 assert.match(branch,/Number\.isSafeInteger\(selectedTopicId\)&&selectedTopicId>0/);
 assert.match(branch,/await publishAccepted\(ctx,"announcement",rev,selectedTopicId\);/);
 assert.ok(branch.indexOf('await publishAccepted(ctx,"announcement",rev,selectedTopicId);')<branch.indexOf('await announcementDestinationPicker(ctx.telegram,ctx.from.id,current);'));
});

test("selected notice destination is visible on final preview",()=>{
 const draft={module:"announcement",step:"preview",revision:9,
  data:{kind:"announcement",title:"告知",body:"本文",destinationLabel:"エリア掲示板 / テストTopic"}} as const;
 const preview=announcementSummary(draft);
 assert.match(preview,/投稿先：エリア掲示板 \/ テストTopic/);
});

 // The adopted 2026-11-15 notice contract distinguishes private preview
 // placeholders from public content. Test the rendered field lines separately.
const unsetNoticeFields=["タイトル","説明","開催日時","受付期限","参加方法"] as const;
for(const field of unsetNoticeFields){
 test(`notice media-only preview renders exact unset field: ${field}`,()=>{
  const data={kind:"announcement",media:[{kind:"video",fileId:"video_1"}]};
  validateNotice(data,1);
  const preview=announcementSummary({module:"announcement",step:"preview",revision:10,data});
  const lines=preview.split("\n").filter(line=>line.includes(field+"："));
  assert.deepEqual(lines,[field+"：［未設定］"]);
  const rich=buildNoticeRichPreview(data,10);
  assert.deepEqual(rich.blocks.filter(block=>block.type==="paragraph"&&JSON.stringify(block.text).includes(field+"：")),
   [{type:"paragraph",text:field+"：［未設定］"}]);
  assert.doesNotMatch(JSON.stringify(rich),/"type":"button"|"callback_data":/);
 });
}
test("notice preview does not offer editing for an unset title or explanation",()=>{
 const cases=[
  {data:{kind:"announcement",title:"題名",body:""},unset:"説明",present:"タイトル"},
  {data:{kind:"announcement",title:"",body:"本文"},unset:"タイトル",present:"説明"}
 ];
 for(const {data,unset,present} of cases){
  const preview=announcementSummary({module:"announcement",step:"preview",revision:11,data});
  const lines=preview.split("\n");
  assert.deepEqual(lines.filter(line=>line.includes(unset+"：")),[unset+"：［未設定］"]);
  const configured=lines.filter(line=>line.includes(present+"："));
  assert.equal(configured.length,1);
  assert.doesNotMatch(preview,/［編集］|[?&]start=/);
  const rich=buildNoticeRichPreview(data,11);
  const field=present==="タイトル"?"title":"body";
  const value=present==="タイトル"?data.title:data.body;
  assert.deepEqual(rich.blocks.filter(block=>block.type==="paragraph"&&JSON.stringify(block.text).includes(unset+"：")),
   [{type:"paragraph",text:unset+"：［未設定］"}]);
  assert.deepEqual(rich.blocks.filter(block=>block.type==="paragraph"&&JSON.stringify(block.text).includes(present+"：")),
   [{type:"paragraph",text:[{type:"button",button:{text:"［編集］",style:"link",callback_data:"post:announce:"+field+":11"}}," "+present+"："+value]}]);
  assert.equal(rich.blocks.filter(block=>JSON.stringify(block).includes('"type":"button"')).length,1);
 }
});
test("notice preview keeps unset options non-editable even when text is registered",()=>{
 const data={kind:"announcement",title:"題名",body:"本文",participation:"none",eventAt:null,deadlineAt:null};
 const preview=announcementSummary({module:"announcement",step:"preview",revision:12,data});
 for(const field of ["開催日時","受付期限","参加方法"]){
  assert.deepEqual(preview.split("\n").filter(line=>line.includes(field+"：")),[field+"：［未設定］"]);
  assert.deepEqual(buildNoticeRichPreview(data,12).blocks.filter(block=>block.type==="paragraph"&&JSON.stringify(block.text).includes(field+"：")),
   [{type:"paragraph",text:field+"：［未設定］"}]);
 }
});
test("media-only public card omits all private placeholders and edit controls",()=>{
 for(const kind of ["photo","video"]){
  const data={kind:"announcement",media:[{kind,fileId:"media_1"}],eventAt:null,deadlineAt:null,participation:"none"};
  validateNotice(data,1);
  assert.equal(noticeCard(data,1),"📢 告知");
 }
});

test("Rich notice preview keeps up to five ordered photo and video references in the same blocks",()=>{
 const media=[
  {kind:"photo",fileId:"photo_1"},{kind:"video",fileId:"video_2"},
  {kind:"photo",fileId:"photo_3"},{kind:"video",fileId:"video_4"},
  {kind:"photo",fileId:"photo_5"},{kind:"video",fileId:"video_6"}
 ];
 const data={kind:"announcement",title:"題名",body:"本文",media};
 const before=JSON.stringify(data);
 const rich=buildNoticeRichPreview(data,7);
 assert.equal(rich.blocks.length,11);
 assert.deepEqual(rich.blocks.slice(6),[
  {type:"photo",photo:{type:"photo",media:"photo_1"}},
  {type:"video",video:{type:"video",media:"video_2"}},
  {type:"photo",photo:{type:"photo",media:"photo_3"}},
  {type:"video",video:{type:"video",media:"video_4"}},
  {type:"photo",photo:{type:"photo",media:"photo_5"}}
 ]);
 assert.equal(JSON.stringify(data),before);
 const mediaOnly=buildNoticeRichPreview({kind:"announcement",media:media.slice(0,2)},8);
 assert.deepEqual(mediaOnly.blocks.slice(6),rich.blocks.slice(6,8));
 assert.doesNotMatch(JSON.stringify(mediaOnly),/"type":"button"|"callback_data":/);
});
test("Rich notice preview rejects invalid action revisions",()=>{
 for(const revision of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>buildNoticeRichPreview({title:"題名",body:"本文"},revision),/NOTICE_REVISION_INVALID/);
 }
});
