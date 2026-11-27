import test from "node:test";
import assert from "node:assert/strict";
import {noticeParts,noticeText,noticeEdit,noticeJoin,noticeMedia,
 validateNotice,noticeCard} from "../src/services/noticeEditor.js";
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
 assert.match(preview, /start=ne_t_7/);
 assert.match(preview, /［編集］<\/a>タイトル：題名/);
 assert.match(preview, /start=ne_b_7/);
 assert.match(preview, /［編集］<\/a>説明：本文/);
 assert.match(preview,/開催日時：未設定/);
 assert.match(preview,/受付期限：未設定/);
 assert.match(preview,/参加方法：未設定/);
 assert.ok(!preview.includes("プロフ連携"));
 assert.ok(!preview.includes("投稿先"));
});
test("media-only notice can be submitted without title or explanation",()=>{
 const data={kind:"announcement",media:[{kind:"photo",fileId:"photo_1"}]};
 validateNotice(data,1);
 assert.equal(noticeText(data),"");
 assert.equal(noticeCard(data,1),"📢 告知");
 const preview=announcementSummary({module:"announcement",step:"preview",revision:8,data});
 assert.match(preview,/タイトル：未設定/);
 assert.match(preview,/説明：未設定/);
 assert.equal(preview.includes("［編集］"),false);
});
test("public announcement omits unset options",()=>{
 const text=noticeCard({kind:"announcement",title:"告知",body:"本文",participation:"none"},1);
 assert.ok(!text.includes("開催："));
 assert.ok(!text.includes("受付終了："));
 assert.ok(!text.includes("未設定"));
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
