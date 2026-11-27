import test, {mock} from "node:test";
import assert from "node:assert/strict";
import {noticeParts,noticeText,noticeEdit,noticeJoin,noticeMedia,
 validateNotice,noticeCard,buildNoticeRichPreview,noticeUrlButton,resolveNoticeDestination} from "../src/services/noticeEditor.js";
import {pool} from "../src/db/index.js";
import {announcementPanel,announcementSummary,startAnnouncementEditor,registerPostingHandlers} from "../src/bot/postingHandlers.js";

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
test("notice preview uses seven in-body edit/register controls and only three footer buttons",()=>{
 const d={module:"announcement",step:"preview",revision:7,data:{kind:"announcement",title:"題名",body:"本文",participation:"none"}} as const;
 assert.deepEqual(announcementPanel(d).reply_markup.inline_keyboard.map(row=>row.map(x=>x.text)),[["投稿する","キャンセル","下書き保存"]]);
 const rich=buildNoticeRichPreview(d.data,d.revision);
 const actions=rich.blocks.filter(b=>Array.isArray(b.text)).map(b=>(b.text as any[])[0].button);
 assert.deepEqual(actions.map(b=>b.callback_data),["title","body","date","deadline","joinmenu","media","link"].map(x=>"post:announce:"+x+":7"));
 assert.deepEqual(actions.map(b=>b.text),["［編集］","［編集］",...Array(5).fill("［未登録］")]);
 assert.ok(!JSON.stringify(rich).includes("?start="));
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

test("notice routing uses exact entry, only offers selection for unknown entry",()=>{
 const a={id:10,board:"area_bbs",purpose:"announcement",chatId:-1003847210571,threadId:8,title:"入口",enabled:true,verifiedAt:new Date()} as const;
 const b={...a,id:11,threadId:9,title:"別Topic"};
 const options=[a,b];
 assert.deepEqual(resolveNoticeDestination(options,a,{topicId:11,noticeDestinationExplicit:true}),{kind:"direct",topic:a});
 assert.deepEqual(resolveNoticeDestination(options,{chatId:a.chatId,threadId:99},{}),{kind:"unavailable"});
 assert.deepEqual(resolveNoticeDestination(options,null,{}),{kind:"choose",topics:options});
 assert.deepEqual(resolveNoticeDestination(options,null,{topicId:11}),{kind:"choose",topics:options});
 assert.deepEqual(resolveNoticeDestination(options,null,{topicId:11,noticeDestinationExplicit:true}),{kind:"direct",topic:b});
 assert.deepEqual(resolveNoticeDestination(options,null,{topicId:99,noticeDestinationExplicit:true}),{kind:"choose",topics:options});
});

test("selected notice destination is visible on final preview",()=>{
 const draft={module:"announcement",step:"preview",revision:9,
  data:{kind:"announcement",title:"告知",body:"本文",destinationLabel:"エリア掲示板 / テストTopic"}} as const;
 const preview=announcementSummary(draft);
 assert.match(preview,/投稿先：エリア掲示板 \/ テストTopic/);
});

 // The adopted 2026-11-15 notice contract distinguishes private preview
 // placeholders from public content. Test the rendered field lines separately.
test("unset fields are tappable registration actions, configured fields are edit actions",()=>{
 const rich=buildNoticeRichPreview({kind:"announcement",title:"題名"},11);
 const fields=rich.blocks.filter(b=>Array.isArray(b.text)).map(b=>(b.text as any[])[0].button);
 assert.equal(fields.length,7);assert.equal(fields[0].text,"［編集］");
 assert.ok(fields.slice(1).every(b=>b.text==="［未登録］"));
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
 assert.equal(rich.blocks.length,13);
 assert.deepEqual(rich.blocks.slice(8),[
  {type:"photo",photo:{type:"photo",media:"photo_1"}},
  {type:"video",video:{type:"video",media:"video_2"}},
  {type:"photo",photo:{type:"photo",media:"photo_3"}},
  {type:"video",video:{type:"video",media:"video_4"}},
  {type:"photo",photo:{type:"photo",media:"photo_5"}}
 ]);
 assert.equal(JSON.stringify(data),before);
 const mediaOnly=buildNoticeRichPreview({kind:"announcement",media:media.slice(0,2)},8);
 assert.deepEqual(mediaOnly.blocks.slice(8),rich.blocks.slice(8,10));
 assert.ok(JSON.stringify(mediaOnly).includes("［未登録］"));
});
test("Rich notice preview rejects invalid action revisions",()=>{
 for(const revision of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>buildNoticeRichPreview({title:"題名",body:"本文"},revision),/NOTICE_REVISION_INVALID/);
 }
});

/** Execute the actual notice entry and registered callback. Only I/O is faked.
 * Unknown SQL or Telegram operations must fail rather than escape to production.
 */
function noticeHandlerFixture(options:{step?:string;data?:Record<string,unknown>;editError?:Error;sendResult?:unknown;dmOwner?:string;stickerError?:Error;origin?:{chatId:number;threadId:number};topics?:any[]}={}){
 const owner=4321,oldId=99,newId=200;
 let draft={step:options.step??"preview",revision:7,data:{
  kind:"announcement",title:"題名",body:"本文",screenMessageId:oldId,
  media:[{kind:"photo",fileId:"photo_1"},{kind:"video",fileId:"video_2"}],
  ...options.data
 } as Record<string,unknown>};
 const events:any[][]=[],answers:any[][]=[],reads:any[][]=[];
 const query=mock.method(pool,"query", (async(sql:string,values:any[])=>{
  if(sql.includes("FROM topic_dm_entry_sessions s"))return {rows:options.origin?[{chat_id:options.origin.chatId,message_thread_id:options.origin.threadId}]:[]};
  if(sql.includes("FROM board_menu_sessions s"))return {rows:[]};
  if(sql.startsWith("SELECT * FROM posting_topics WHERE purpose="))return {rows:options.topics??[]};
  if(sql.startsWith("SELECT * FROM posting_topics WHERE topic_id="))return {rows:(options.topics??[]).filter(x=>Number(x.topic_id)===values[0])};
  if(sql.includes("FROM gaybbs_feature_release_gates"))return {rows:[]}; // deliberately closed; no actual publication
  if(sql.includes("SELECT module FROM (")&&sql.includes("candidates ORDER BY updated_at")){
   assert.equal(values[0],owner);
   return {rows:[{module:options.dmOwner??"announcement"}]};
  }
  if(sql.includes("'{noticeStickerPreviews}'")){
   assert.equal(values[0],owner);assert.equal(values[1],draft.revision);
   draft.data.noticeStickerPreviews=JSON.parse(values[2]);
   events.push(["stickers-bind",structuredClone(draft.data.noticeStickerPreviews)]);
   return {rows:[{owner_user_id:owner}]};
  }
  assert.equal(values[1],"announcement");
  if(sql==="SELECT step,data,revision FROM public_post_drafts WHERE owner_user_id=$1 AND module=$2"){
   reads.push(values);
   return {rows:values[0]===owner?[structuredClone(draft)]:[]};
  }
  assert.equal(values[0],owner);
  assert.equal(values[2],draft.revision);
  if(sql==="UPDATE public_post_drafts SET data=jsonb_set(data,'{screenMessageId}',to_jsonb($4::integer),true) WHERE owner_user_id=$1 AND module=$2 AND revision=$3 RETURNING owner_user_id"){
   events.push(["bind",...values]);
   draft.data.screenMessageId=values[3];
   return {rows:[{owner_user_id:owner}]};
  }
  if(sql.replace(/\s+/g," ").trim()==="UPDATE public_post_drafts SET step=$4,data=$5::jsonb,revision=revision+1,updated_at=NOW() WHERE owner_user_id=$1 AND module=$2 AND revision=$3 RETURNING step,data,revision"){
   events.push(["update",...values]);
   draft={step:values[3],revision:draft.revision+1,data:JSON.parse(values[4])};
   return {rows:[structuredClone(draft)]};
  }
  assert.fail("Unexpected notice fixture SQL: "+sql);
 }) as any);
 const forbid=async (...args:any[])=>{events.push(["forbidden",...args]);throw Error("UNEXPECTED_TELEGRAM_IO");};
 const telegram={
  async callApi(method:string,args:Record<string,unknown>){
   if(typeof args.rich_message==="string")args={...args,rich_message:JSON.parse(args.rich_message)};
   events.push([method,args]);
   if(options.stickerError&&Object.hasOwn(args,"notice_sticker_0"))throw options.stickerError;
   assert.ok(method==="editMessageText"||method==="sendRichMessage");
   if(method==="editMessageText"){
    if(options.editError)throw options.editError;
    return true;
   }
   return Object.hasOwn(options,"sendResult")?options.sendResult:{message_id:newId};
  },
  async editMessageText(...args:any[]){events.push(["plain-edit",...args]);return true;},
  async deleteMessage(...args:any[]){events.push(["delete",...args]);return true;},
  async getFileLink(){return new URL("https://api.telegram.org/file/mock-test/sticker.png");},
  sendSticker:forbid,
  sendPhoto:forbid,sendVideo:forbid,sendMediaGroup:forbid,sendMessage:forbid,
 };
 const actions:Array<{pattern:RegExp;handler:Function}>=[];
 const handlers=new Map<string,Function[]>();
 const bot={
  command(_key:unknown,_fn:Function){},
  action(pattern:unknown,handler:Function){if(pattern instanceof RegExp)actions.push({pattern,handler});},
  on(key:string,fn:Function){handlers.set(key,[...(handlers.get(key)??[]),fn]);}
 };
 async function callback(field:"title"|"body"|"link"|"media"|"back"|"publish"|"topics",overrides:{fromId?:number;chatId?:number;chatType?:string;messageChatId?:number;messageId?:number;revision?:number;omitMessage?:boolean;raw?:string}={}){
  actions.length=0;handlers.clear();registerPostingHandlers(bot as any);
  const data=overrides.raw??"post:announce:"+field+":"+(overrides.revision??7);
  const matching=actions.filter(a=>a.pattern.test(data));
  assert.equal(matching.length,1,"exactly one registered notice callback");
  const action=matching[0]!;
  const ctx={
   from:{id:overrides.fromId??owner},
   chat:{type:overrides.chatType??"private",id:overrides.chatId??owner},
   match:action.pattern.exec(data),
   callbackQuery:{data,...(overrides.omitMessage?{}:{message:{message_id:overrides.messageId??oldId,
    chat:{type:"private",id:overrides.messageChatId??owner}}})},
   telegram,answerCbQuery:async (...args:any[])=>{answers.push(args);},
   reply:async (...args:any[])=>{events.push(["reply",...args]);},editMessageText:forbid,
  };
  await action.handler(ctx);
 }
 async function receive(type:"sticker"|"text",input:string){
  actions.length=0;handlers.clear();registerPostingHandlers(bot as any);
  const ctx={from:{id:owner},chat:{type:"private",id:owner},telegram,
   message:{message_id:101,...(type==="sticker"?{sticker:{file_id:input}}:{text:input})}};
  const list=handlers.get(type)??[];
  assert.ok(list.length>0);
  async function dispatch(i:number):Promise<void>{if(i<list.length)await list[i]!(ctx,()=>dispatch(i+1));}
  await dispatch(0);
 }
 const network=mock.method(globalThis,"fetch",async()=>new Response(Buffer.from([137,80,78,71,13,10,26,10,0])));
 return {owner,oldId,newId,telegram,events,answers,reads,callback,receive,
  get draft(){return draft;},
  start:()=>startAnnouncementEditor(telegram as any,owner),
  restore:()=>{network.mock.restore();query.mock.restore();}};
}
function assertNoticeRichTransport(args:any,owner:number,messageId?:number){
 assert.equal(args.chat_id,owner);
 assert.equal(args.message_id,messageId);
 assert.deepEqual(args.rich_message.blocks.slice(8),[
  {type:"photo",photo:{type:"photo",media:"photo_1"}},
  {type:"video",video:{type:"video",media:"video_2"}}
 ]);
 assert.deepEqual(args.rich_message.blocks[1],{type:"paragraph",text:[
  {type:"button",button:{text:"［編集］",style:"link",callback_data:"post:announce:title:7"}}," タイトル：題名"]});
 assert.deepEqual(args.rich_message.blocks[2],{type:"paragraph",text:[
  {type:"button",button:{text:"［編集］",style:"link",callback_data:"post:announce:body:7"}}," 説明：本文"]});
 assert.deepEqual(args.reply_markup.inline_keyboard.map((row:any[])=>row.map(b=>[b.text,b.callback_data])),[
  [["投稿する","post:announce:publish:7"],["キャンセル","post:announce:cancel:7"],["下書き保存","post:announce:save:7"]]
 ]);
}
test("notice entry edits the existing private Rich screen with both media and three footer callbacks",async()=>{
 const f=noticeHandlerFixture();
 try{
  await f.start();
  assert.deepEqual(f.events.map(e=>e[0]),["editMessageText"]);
  assertNoticeRichTransport(f.events[0]![1],f.owner,f.oldId);
  assert.equal(f.draft.data.screenMessageId,f.oldId);
 }finally{f.restore();}
});
test("definite notice edit rejection sends one Rich replacement, binds it before deleting the old private screen",async()=>{
 const f=noticeHandlerFixture({editError:Error("400: Bad Request: message cannot be edited")});
 try{
  await f.start();
  assert.deepEqual(f.events.map(e=>e[0]),["editMessageText","sendRichMessage","bind","delete"]);
  assertNoticeRichTransport(f.events[0]![1],f.owner,f.oldId);
  assertNoticeRichTransport(f.events[1]![1],f.owner);
  assert.deepEqual(f.events[2],["bind",f.owner,"announcement",7,f.newId]);
  assert.deepEqual(f.events[3],["delete",f.owner,f.oldId]);
  assert.equal(f.draft.data.screenMessageId,f.newId);
  assert.equal(f.draft.revision,7);
 }finally{f.restore();}
});
test("unchanged notice edit does not send, bind or delete",async()=>{
 const f=noticeHandlerFixture({editError:Error("400: Bad Request: message is not modified")});
 try{
  await f.start();
  assert.deepEqual(f.events.map(e=>e[0]),["editMessageText"]);
  assert.equal(f.draft.data.screenMessageId,f.oldId);
 }finally{f.restore();}
});
for(const reason of ["ETIMEDOUT","socket hang up","400: Bad Request: invalid rich message"]){
 test("notice edit rejects without replacement on "+reason,async()=>{
  const error=Error(reason),f=noticeHandlerFixture({editError:error});
  try{
   await assert.rejects(f.start(),e=>e===error);
   assert.deepEqual(f.events.map(e=>e[0]),["editMessageText"]);
   assert.equal(f.draft.data.screenMessageId,f.oldId);
  }finally{f.restore();}
 });
}
test("notice replacement with unconfirmed message ID never binds or deletes the old screen",async()=>{
 for(const sendResult of [null,{}, {message_id:0},{message_id:-1},{message_id:1.5},{message_id:"200"}]){
  const f=noticeHandlerFixture({editError:Error("400: Bad Request: message cannot be edited"),sendResult});
  try{
   await assert.rejects(f.start(),/NOTICE_RICH_SCREEN_UNCONFIRMED/);
   assert.deepEqual(f.events.map(e=>e[0]),["editMessageText","sendRichMessage"]);
   assert.equal(f.draft.data.screenMessageId,f.oldId);
  }finally{f.restore();}
 }
});
for(const field of ["title","body"] as const){
 test("registered notice "+field+" callback updates only the matching private preview",async()=>{
  const f=noticeHandlerFixture();
  try{
   const before=structuredClone(f.draft.data);
   await f.callback(field);
   assert.deepEqual(f.events.map(e=>e[0]),["update","plain-edit"]);
   assert.deepEqual(f.reads,[[f.owner,"announcement"]]);
   assert.equal(f.draft.step,"awaiting_text");
   assert.equal(f.draft.revision,8);
   assert.deepEqual(f.draft.data,{...before,editField:field});
   assert.deepEqual(f.events[0]!.slice(1,5),[f.owner,"announcement",7,"awaiting_text"]);
   assert.deepEqual(f.events[1]!.slice(1,4),[f.owner,f.oldId,undefined]);
   assert.equal(f.events[1]![4],field==="title"?"タイトルを入力してください。":"内容を入力してください。");
   assert.equal(f.events[1]![5].reply_markup.inline_keyboard[0][0].callback_data,"post:announce:back:8");
   assert.deepEqual(f.answers,[[]]);
  }finally{f.restore();}
 });
}
test("registered notice edit callbacks reject each owner, chat, revision, screen and state mismatch without mutation or sending",async()=>{
 const cases:Array<{label:string;fixture?:Parameters<typeof noticeHandlerFixture>[0];callback?:Parameters<ReturnType<typeof noticeHandlerFixture>["callback"]>[1]}>=[
  {label:"other owner",callback:{fromId:9876,chatId:9876,messageChatId:9876}},
  {label:"group",callback:{chatType:"supergroup",chatId:-100}},
  {label:"wrong private chat",callback:{chatId:9876}},
  {label:"wrong message chat",callback:{messageChatId:9876}},
  {label:"wrong revision",callback:{revision:6}},
  {label:"wrong screen",callback:{messageId:98}},
  {label:"missing screen",callback:{omitMessage:true}},
  {label:"missing bound ID",fixture:{data:{screenMessageId:undefined}}},
  {label:"awaiting input",fixture:{step:"awaiting_text"}},
  {label:"date picker",fixture:{data:{noticePickerStage:"date_calendar"}}},
  {label:"recruitment draft",fixture:{data:{kind:"recruitment"}}}
 ];
 for(const field of ["title","body"] as const){
  for(const c of cases){
   const f=noticeHandlerFixture(c.fixture);
   try{
    const before=structuredClone(f.draft);
    await f.callback(field,c.callback);
    assert.deepEqual(f.events,[],c.label);
    assert.deepEqual(f.draft,before,c.label);
    if(c.label==="group")assert.deepEqual(f.answers,[]);
    else assert.ok(f.answers.some(a=>typeof a[0]==="string"&&a[0].includes("古い")),c.label);
   }finally{f.restore();}
  }
 }
});

test("notice link preview exposes the exact clickable URL and preserves three controls",()=>{
 const data=noticeEdit({kind:"announcement",title:"テスト",body:"説明"},"link","詳細を見る\nhttps://example.com/details");
 const link=noticeUrlButton(data);
 assert.deepEqual(link,{text:"詳細を見る",url:"https://example.com/details"});
 const rich=buildNoticeRichPreview(data,7);
 assert.deepEqual(rich.blocks.at(-1),{type:"buttons",buttons:[link]});
 assert.equal(announcementPanel({module:"announcement",step:"preview",revision:7,data}).reply_markup.inline_keyboard.flat().length,3);
 assert.equal(buildNoticeRichPreview(noticeEdit(data,"link","なし"),8).blocks.some(x=>x.type==="buttons"),false);
});
test("native sticker is saved as sticker, counts toward five, and is not an invalid Rich video",()=>{
 const data={kind:"announcement",media:[{kind:"sticker",fileId:"sticker_file"}]};
 assert.deepEqual(noticeMedia(data),data.media);
 validateNotice(data,1);
 assert.equal(noticeCard(data,1),"📢 告知");
 const blocks=buildNoticeRichPreview(data,1).blocks;
 assert.ok(blocks.some(x=>typeof x.text==="string"&&x.text.includes("画像プレビュー未確認")));
 assert.equal(blocks.some(x=>x.type==="video"||x.type==="photo"),false);
 assert.deepEqual(noticeMedia(noticeEdit(data,"media","なし")),[]);
});
test("native sticker and mixed albums use native delivery and the registered link",async()=>{
 const {createTelegramDispatcher}=await import("../src/services/telegramDispatcher.js");
 const calls:any[][]=[];
 const t=Object.fromEntries(["sendMessage","sendSticker","sendPhoto","sendVideo","sendMediaGroup"].map(k=>[k,async(...args:any[])=>{calls.push([k,...args]);return {message_id:123};}]));
 const target={chatId:-100123,threadId:8};
 const buttons=[[{text:"詳細",url:"https://example.com/"}]];
 const result=await createTelegramDispatcher(t as any).publish(target,{text:"告知",buttons,media:[
  {kind:"photo",fileId:"p1"},{kind:"video",fileId:"v1"},{kind:"sticker",fileId:"s1"},{kind:"photo",fileId:"p2"}]});
 assert.equal(result,123);
 assert.deepEqual(calls.map(x=>x[0]),["sendMessage","sendMediaGroup","sendSticker","sendPhoto"]);
 assert.equal(calls[0]![3].reply_markup.inline_keyboard[0][0].url,"https://example.com/");
 assert.deepEqual(calls[2],["sendSticker",target.chatId,"s1",{message_thread_id:8}]);
});

test("registered sticker is embedded into same Rich editor before input deletion",async()=>{
 const f=noticeHandlerFixture({step:"awaiting_media",data:{media:[]}});
 try{
  await f.receive("sticker","native_sticker_1");
  assert.deepEqual(noticeMedia(f.draft.data),[{kind:"sticker",fileId:"native_sticker_1"}]);
  assert.deepEqual(f.events.map(e=>e[0]),["update","editMessageText","delete"]);
  const call=f.events[1]![1];
  assert.ok(call.notice_sticker_0.source);
  assert.ok(call.rich_message.blocks.some((b:any)=>b.type==="photo"&&b.photo.media==="attach://notice_sticker_0"));
  assert.deepEqual(f.events.at(-1),["delete",f.owner,101]);
  await f.callback("media",{revision:f.draft.revision});await f.receive("text","なし");
  assert.deepEqual(noticeMedia(f.draft.data),[]);
 }finally{f.restore();}
});
test("legacy native sticker copies removed after combined editor rendered",async()=>{
 const f=noticeHandlerFixture({data:{media:[{kind:"sticker",fileId:"s1"}],noticeStickerPreviews:[{fileId:"s1",messageId:501}]}});
 try{await f.start();assert.deepEqual(f.events.map(e=>e[0]),["editMessageText","delete","stickers-bind"]);assert.deepEqual(f.events[1],["delete",f.owner,501]);}finally{f.restore();}
});
test("notice sticker receiver never consumes another DM owner input",async()=>{
 const f=noticeHandlerFixture({step:"awaiting_media",dmOwner:"profile",data:{media:[]}});
 try{await f.receive("sticker","foreign");assert.deepEqual(f.events,[]);assert.deepEqual(noticeMedia(f.draft.data),[]);}finally{f.restore();}
});
test("sticker preview transport uncertainty preserves original input and never sends native copy",async()=>{
 const f=noticeHandlerFixture({step:"awaiting_media",data:{media:[]},stickerError:Error("ETIMEDOUT")});
 try{
  await f.receive("sticker","native_sticker_1");
  assert.ok(!f.events.some(e=>e[0]==="delete"&&e[2]===101));
  assert.ok(!f.events.some(e=>e[0]==="forbidden"));
  assert.match(JSON.stringify(f.events.at(-1)),/素材は保存/);
 }finally{f.restore();}
});
test("registered link edit accepts two lines, exposes real URL and removes it on clear",async()=>{
 const f=noticeHandlerFixture();
 try{
  await f.callback("link");assert.equal(f.draft.data.editField,"link");
  await f.receive("text","詳細を見る\nhttps://example.com/path");
  assert.equal(f.draft.step,"preview");
  const rich=f.events.filter(e=>e[0]==="editMessageText").at(-1)![1].rich_message;
  assert.deepEqual(rich.blocks.at(-1),{type:"buttons",buttons:[{text:"詳細を見る",url:"https://example.com/path"}]});
  await f.callback("link",{revision:f.draft.revision});
  await f.receive("text","なし");
  assert.equal(f.draft.data.linkUrl,null);
  assert.ok(!f.events.filter(e=>e[0]==="editMessageText").at(-1)![1].rich_message.blocks.some((b:any)=>b.type==="buttons"));
 }finally{f.restore();}
});

test("initial sticker input preserves ability to add title and body afterwards",async()=>{
 const f=noticeHandlerFixture({step:"awaiting_text",data:{title:"",body:"",editField:"initial",media:[]}});
 try{
  await f.receive("sticker","native_sticker_1");
  assert.equal(f.draft.step,"awaiting_text");
  await f.receive("text","新タイトル\n説明");
  assert.equal(f.draft.step,"preview");
  assert.deepEqual(noticeParts(f.draft.data),{title:"新タイトル",body:"説明"});
  assert.deepEqual(noticeMedia(f.draft.data),[{kind:"sticker",fileId:"native_sticker_1"}]);
  assert.ok(f.events.filter(e=>e[0]==="editMessageText").every(e=>e[1].rich_message.blocks.some((b:any)=>b.type==="photo")));
 }finally{f.restore();}
});

const noticeTopicRows=[{topic_id:10,board_key:"area_bbs",purpose:"announcement",chat_id:-1003847210571,message_thread_id:8,title:"入口Topic",verified_at:new Date(Date.now()-1000).toISOString(),enabled:true},
 {topic_id:11,board_key:"area_bbs",purpose:"announcement",chat_id:-1003847210571,message_thread_id:9,title:"別Topic",verified_at:new Date(Date.now()-1000).toISOString(),enabled:true}];
test("known notice entry advances directly to publication checks, never opens chooser",async()=>{
 const f=noticeHandlerFixture({origin:{chatId:-1003847210571,threadId:8},topics:noticeTopicRows,data:{topicId:11,noticeDestinationExplicit:true}});
 try{
  await f.callback("publish");
  assert.equal(f.draft.data.topicId,10);
  assert.equal(f.draft.data.noticeDestinationExplicit,false);
  assert.ok(f.answers.some(a=>a[0]==="公開処理を確認しています"));
  assert.ok(f.events.some(e=>e[0]==="editMessageText"&&JSON.stringify(e[1].rich_message).includes("告知の公開状態を確認できません")));
  assert.ok(!f.events.some(e=>e[0]==="reply"));
  assert.ok(!f.events.some(e=>e[0]==="plain-edit"));
 }finally{f.restore();}
});
test("unknown entry exposes actual verified topic buttons, accepts selection even for sticker-only notice",async()=>{
 const f=noticeHandlerFixture({topics:noticeTopicRows,data:{title:"",body:"",text:"",media:[]}});
 try{
  // A sticker-only draft; populate media through the real input handler.
  await f.receive("sticker","test_sticker");
  await f.callback("publish",{revision:f.draft.revision});
  const screen=f.events.filter(e=>e[0]==="plain-edit").at(-1)!;
  assert.match(screen[4],/入口のトピックが不明/);
  const buttons=screen[5].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b:any)=>b.callback_data==="post:choose:announcement:"+f.draft.revision+":11"));
  await f.callback("publish",{raw:"post:choose:announcement:"+f.draft.revision+":11"});
  assert.equal(f.draft.data.topicId,11);
  assert.equal(f.draft.data.noticeDestinationExplicit,true);
  assert.match(String(f.draft.data.destinationLabel),/別Topic/);
 }finally{f.restore();}
});
test("known but unregistered notice entry never exposes alternative destination",async()=>{
 const f=noticeHandlerFixture({origin:{chatId:-1003847210571,threadId:77},topics:noticeTopicRows});
 try{
  await f.callback("publish");
  const screen=f.events.filter(e=>e[0]==="plain-edit").at(-1)!;
  assert.match(screen[4],/別のトピックには投稿しません/);
  assert.equal(screen[5].reply_markup.inline_keyboard.flat().length,1);
  assert.equal(f.draft.revision,7);
 }finally{f.restore();}
});

test("unregistered title can be opened from same private body",async()=>{
 const f=noticeHandlerFixture({data:{title:""}});
 try{await f.callback("title");assert.equal(f.draft.data.editField,"title");assert.equal(f.draft.step,"awaiting_text");}finally{f.restore();}
});
test("notice entry link uses notice ownership, not recruitment-only lookup",async()=>{
 const {makeNoticeApplicationLink}=await import("../src/services/applicationLinks.js");
 const calls:any[][]=[];
 const q=mock.method(pool,"query",async(sql:string,values:any[])=>{
  calls.push([sql,values]);return {rows:sql.includes("SELECT announcement_id")?[{announcement_id:55}]:[]};
 });
 try{
  const link=await makeNoticeApplicationLink(4321,55);
  assert.ok(link.startsWith("https://t.me/GayBBS_bot?start=a_"));
  assert.ok(calls[0]![0].includes("kind IN ('announcement','preview') AND room_id IS NULL"));
  assert.deepEqual(calls[0]![1],[55,4321]);
  assert.ok(calls[1]![0].includes("INSERT INTO announcement_application_entries"));
 }finally{q.mock.restore();}
});
