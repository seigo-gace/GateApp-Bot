import test from "node:test";
import assert from "node:assert/strict";
import {noticeParts,noticeText,noticeEdit,noticeJoin,noticeMedia,
 validateNotice,noticeCard} from "../src/services/noticeEditor.js";
import {announcementPanel} from "../src/bot/postingHandlers.js";

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
test("notice preview and public card require title and body",()=>{
 assert.throws(()=>validateNotice({kind:"announcement",title:"題名"},1));
 const data={kind:"announcement",title:"題名",body:"本文",text:"題名\n本文",
  participation:"public",deadlineAt:"2030-01-01T11:00:00.000Z"};
 validateNotice(data,1);
 assert.match(noticeCard(data,1),/題名/);
 assert.match(noticeCard(data,1),/受付終了/);
});
test("pre-publication roleplay controls do not show post-registration edit buttons",()=>{
 const panel=announcementPanel({module:"announcement",step:"preview",revision:7,
  data:{kind:"announcement",title:"題名",body:"本文",text:"題名\\n本文",
   participation:"public"}});
 const rows=panel.reply_markup.inline_keyboard;
 assert.deepEqual(rows[1]?.map(x=>x.text),["開催日時","受付期限"]);
 assert.equal(rows[2]?.[0]?.text,"✅ 自由参加");
 assert.ok(rows.flat().some(x=>x.callback_data==="post:announce:link:7"));
 assert.ok(rows.flat().some(x=>x.callback_data==="post:announce:media:7"));
 assert.ok(rows.flat().some(x=>x.text==="📢 投稿する"));
 assert.equal(rows.flat().some(x=>x.text.includes("編集")),false);
 assert.equal(rows.flat().some(x=>x.text.startsWith("タイトル：")),false);
});
