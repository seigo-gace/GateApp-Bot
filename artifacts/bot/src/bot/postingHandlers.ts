import { Markup, type Telegraf, type Telegram } from "telegraf";
import { getProfile, recordProfilePublication } from "../services/profileRepository.js";
import { renderPublicProfile, escapeProfileHtml } from "../services/profileCore.js";
import { listVerifiedTopics, getVerifiedTopic } from "../services/postingDelivery.js";
import { publishPost } from "../services/publishService.js";
import { buildRoomCard, buildAnnouncementCard, validateAnnouncement,
  validateRoom,assertHttpsMeetingUrl,parseJstDateTime,type AnnouncementKind } from "../services/postingDomain.js";
import { beginDraft,getDraft,getWaitingDraft,updateDraft,createRoom,createLinkButton,
 createAnnouncement,markDraftPublished,type PostModule,type EditorDraft } from "../services/publicPostRepository.js";
import type { PostPurpose } from "../services/topicRouting.js";
import { currentMenuOrigin } from "../services/menuOriginRepository.js";
import { PURPOSE_TAGS, validateAnnouncementTags, normalizePlaceCodes } from "../services/announcementTags.js";
import {parseLinkInput,renderLinkCard,buttonGrid,type LinkDraft} from "../services/linkButtonDomain.js";

type Module="profile"|"room"|"announcement"|"link";
const LABELS:Record<Module,string>={profile:"プロフィール",room:"ROOM",announcement:"告知・募集",link:"リンクボタン"};
function privateDM(ctx:{chat?:{type:string}}):boolean{return ctx.chat?.type==="private";}
function preview(module:Module,draft:EditorDraft):string {
 if(module==="link"){
  const d=draft.data as LinkDraft;
  return renderLinkCard(d)+"\n"+d.buttons.map((b,i)=>
   (i+1)+". "+escapeProfileHtml(b.label)+" → "+escapeProfileHtml(new URL(b.url).hostname)).join("\n")+
   "\n表示列数："+d.columns;
 }
 if(module==="room"){
  const title=String(draft.data.title||"");
  const url=draft.data.externalUrl ? String(draft.data.externalUrl) : undefined;
  return buildRoomCard(validateRoom({ownerId:1,name:title,mode:url?"external":"jitsi",
   externalUrl:url,status:"ready"}),url||"");
 }
 const kind=draft.data.kind as AnnouncementKind;
 return buildAnnouncementCard(validateAnnouncement({ownerId:1,kind,
  text:String(draft.data.text||""),
  eventAt:draft.data.eventAt?new Date(String(draft.data.eventAt)):undefined,
  purposeCodes:Array.isArray(draft.data.purposeCodes)?draft.data.purposeCodes as string[]:[],
  placeCodes:Array.isArray(draft.data.placeCodes)?draft.data.placeCodes as string[]:[]}));
}
async function destinationMenu(ctx:{reply:Function;from?:{id:number}},module:Module,revision:number):Promise<void>{
 const options=await listVerifiedTopics(module as PostPurpose);
 if(!options.length){
  await ctx.reply("投稿先の実Topic IDがまだ確認されていません。管理者によるトピック接続後に公開できます。下書きは保持しています。");
  return;
 }
 const origin=ctx.from?.id?await currentMenuOrigin(ctx.from.id):null;
 // N14: the topic a member came from is their default. It may not be a
 // suitable purpose/board (e.g. Profile has its own dedicated topic).
 // No guessed destination or silently substituted topic.
 const matched=origin?options.find(x=>x.chatId===origin.chatId&&
  x.threadId===origin.threadId):undefined;
 const sorted=matched?[matched,...options.filter(x=>x.id!==matched.id)]:options;
 const prefix=origin?(matched?
  "✅ 元のトピックを候補の先頭に表示しています。":
  "元のトピックはこの投稿種別に未登録です。別の実Topicを明示選択してください。"):
  "元のトピックが不明なため、実Topicを明示選択してください。";
 await ctx.reply(prefix+"\\n投稿先を選択してください。まだ公開しません。",
  Markup.inlineKeyboard(sorted.slice(0,30).map(t=>[
   Markup.button.callback((matched?.id===t.id?"📍 ":"")+t.title+" / "+t.board,
    `post:choose:${module}:${revision}:${t.id}`)])));
}
function tagPanel(draft:EditorDraft) {
 const purposes=Array.isArray(draft.data.purposeCodes)?draft.data.purposeCodes as string[]:[];
 const places=Array.isArray(draft.data.placeCodes)?draft.data.placeCodes as string[]:[];
 const rows=PURPOSE_TAGS.map((tag,i)=>[
  Markup.button.callback((purposes.includes(tag)?"✅ ":"▫️ ")+tag,
    "post:tag:"+draft.revision+":"+i)]);
 rows.push([Markup.button.callback((places.includes("場所あり")?"✅ ":"▫️ ")+"場所あり",
   "post:place:"+draft.revision+":0")]);
 rows.push([Markup.button.callback((places.includes("場所なし")?"✅ ":"▫️ ")+"場所なし",
   "post:place:"+draft.revision+":1")]);
 rows.push([Markup.button.callback((places.includes("足あり")?"✅ ":"▫️ ")+"足あり（独立）",
   "post:place:"+draft.revision+":2")]);
 rows.push([Markup.button.callback("✅ タグ選択を確定",
   "post:tagsdone:"+draft.revision)]);
 return Markup.inlineKeyboard(rows);
}
/** The same editor is called from /room and an authenticated M2 entry. */
export async function startRoomEditor(telegram:Telegram,userId:number):Promise<void>{
 await beginDraft(userId,"room","awaiting_text");
 await telegram.sendMessage(userId,
  "🎬 ROOM名を入力してください。持込URLを使う場合は「ROOM名 | https://...」と1通で送れます。URL省略時はJitsiを生成します。");
}
/** LinkButton uses the same DM draft, owner and verified topic as other posts. */
export async function startLinkEditor(telegram:Telegram,userId:number):Promise<void>{
 await beginDraft(userId,"link","awaiting_text");
 await telegram.sendMessage(userId,
  "🔗 1行目に本文、2行目以降に「表示名 | https://URL」を1ボタン1行で送ってください。\n列数は次の画面で1〜3列から選べます。短縮URL・HTTP・ローカル宛先は拒否します。");
}
/** Announcement category editor shared by command and Topic deep link. */
export async function startAnnouncementEditor(telegram:Telegram,userId:number):Promise<void>{
 const draft=await beginDraft(userId,"announcement","awaiting_kind");
 await telegram.sendMessage(userId,"📢 投稿の種類を選択してください。",
  Markup.inlineKeyboard([
   [Markup.button.callback("告知",`post:kind:${draft.revision}:announcement`)],
   [Markup.button.callback("予告",`post:kind:${draft.revision}:preview`)],
   [Markup.button.callback("募集",`post:kind:${draft.revision}:recruitment`)],
  ]));
}
export function registerPostingHandlers(bot:Telegraf):void{
 bot.command("publishprofile",async ctx=>{
  if(!privateDM(ctx))return;
  const p=await getProfile(ctx.from.id);
  if(!p){await ctx.reply("先に /profile で登録してください。");return;}
  await destinationMenu(ctx,"profile",p.revision);
 });
 bot.command("room",async ctx=>{
  if(!privateDM(ctx))return;
  await startRoomEditor(ctx.telegram,ctx.from.id);
 });
 bot.command("link",async ctx=>{
  if(!privateDM(ctx))return;
  await startLinkEditor(ctx.telegram,ctx.from.id);
 });
 bot.command("announce",async ctx=>{
  if(!privateDM(ctx))return;
  await startAnnouncementEditor(ctx.telegram,ctx.from.id);
 });
 bot.action(/^post:kind:(\d+):(announcement|preview|recruitment)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]);const kind=ctx.match[2] as AnnouncementKind;
  const draft=await getDraft(ctx.from.id,"announcement");
  if(!draft||draft.revision!==rev||draft.step!=="awaiting_kind"){
   await ctx.answerCbQuery("古い操作です。/announce で再開してください。");return;
  }
  await updateDraft(ctx.from.id,"announcement",rev,"awaiting_text",{kind});
  await ctx.answerCbQuery();
  await ctx.reply(kind==="preview"?
   "予告文を送ってください。開催日時は公開前に別途必要です。":
   "本文を1通で送ってください。公開前に内容と投稿先を確認します。");
 });
 bot.action(/^post:tag:(\d+):(\d{1,2})$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]), i=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.step!=="awaiting_tags"||d.revision!==rev||i>=PURPOSE_TAGS.length){
   await ctx.answerCbQuery("古い操作です。/announce で再開してください。");return;
  }
  const tag=PURPOSE_TAGS[i]!;
  const values=Array.isArray(d.data.purposeCodes)?d.data.purposeCodes as string[]:[];
  const selected=values.includes(tag)?values.filter(x=>x!==tag):[...values,tag];
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",
   {...d.data,purposeCodes:selected});
  await ctx.answerCbQuery();
  await ctx.editMessageText("🎯 募集目的・📍場所/移動を選択してください（足ありは独立）",
   tagPanel(next));
 });
 bot.action(/^post:place:(\d+):([012])$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]),index=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.step!=="awaiting_tags"||d.revision!==rev){
   await ctx.answerCbQuery("古い操作です。/announce で再開してください。");return;
  }
  const current=Array.isArray(d.data.placeCodes)?d.data.placeCodes as string[]:[];
  const place=index===0?"場所あり":index===1?"場所なし":null;
  const previous=current.includes("場所あり")?"場所あり":
    current.includes("場所なし")?"場所なし":null;
  const selected=place?(previous===place?null:place):previous;
  const transport=index===2?!current.includes("足あり"):current.includes("足あり");
  const placeCodes=normalizePlaceCodes(selected,transport);
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",
   {...d.data,placeCodes});
  await ctx.answerCbQuery();
  await ctx.editMessageText("🎯 募集目的・📍場所/移動を選択してください（足ありは独立）",
   tagPanel(next));
 });
 bot.action(/^post:tagsdone:(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.step!=="awaiting_tags"||d.revision!==rev){
   await ctx.answerCbQuery("古い操作です。/announce で再開してください。");return;
  }
  const purposeCodes=Array.isArray(d.data.purposeCodes)?d.data.purposeCodes as string[]:[];
  const placeCodes=Array.isArray(d.data.placeCodes)?d.data.placeCodes as string[]:[];
  try{
   validateAnnouncementTags({purposeCodes,placeCodes});
   validateAnnouncement({ownerId:ctx.from.id,kind:"recruitment",
    text:String(d.data.text),purposeCodes,placeCodes});
   const updated=await updateDraft(ctx.from.id,"announcement",rev,"preview",d.data);
   await ctx.answerCbQuery();
   await ctx.editMessageText("プレビュー（まだ投稿していません）\n"+preview("announcement",updated));
   await destinationMenu(ctx,"announcement",updated.revision);
  }catch(e){
   await ctx.answerCbQuery(e instanceof Error?e.message:"タグ内容を確認してください。");
  }
 });
 bot.on("text",async(ctx,next)=>{
  if(!privateDM(ctx)||ctx.message.text.startsWith("/"))return next();
  const current=await getWaitingDraft(ctx.from.id);
  if(!current)return next();
  const input=ctx.message.text.trim();
  try{
   let data:Record<string,unknown>;
   if(current.step==="awaiting_datetime"){
    const date=parseJstDateTime(input);
    data={...current.data,eventAt:date.toISOString()};
    validateAnnouncement({ownerId:ctx.from.id,
      kind:data.kind as AnnouncementKind,text:String(data.text),eventAt:date});
    const updated=await updateDraft(ctx.from.id,current.module,current.revision,"preview",data);
    await ctx.reply("プレビュー（まだ投稿していません）\n"+preview(current.module,updated));
    await destinationMenu(ctx,current.module,updated.revision);
    return;
   }
   if(current.module==="link"){
    const parsed=parseLinkInput(input);
    const updated=await updateDraft(ctx.from.id,"link",current.revision,"preview",
      {...parsed,columns:1});
    await ctx.reply("プレビュー（まだ投稿していません）\n"+preview("link",updated));
    await ctx.reply("ボタンの表示列数を選択してください。",
      Markup.inlineKeyboard([[1,2,3].map(i=>Markup.button.callback(
        i+"列",`post:linkcols:${updated.revision}:${i}`))]));
    return;
   }
   if(current.module==="room"){
    const parts=input.split(" | ");
    if(parts.length>2)throw new Error("ROOM名とURLは「 | 」で区切ってください。");
    const name=parts[0]?.trim()||"";
    const externalUrl=parts.length===2?assertHttpsMeetingUrl(parts[1]!):undefined;
    validateRoom({ownerId:ctx.from.id,name,mode:externalUrl?"external":"jitsi",
     externalUrl,status:"ready"});
    data={title:name,externalUrl:externalUrl||null};
   }else{
    if(!current.data.kind)throw new Error("投稿種別が未選択です。");
    const kind=current.data.kind as AnnouncementKind;
    if(kind==="preview"){
     await updateDraft(ctx.from.id,current.module,current.revision,"awaiting_datetime",
       {...current.data,text:input});
     await ctx.reply("開催日時を1通で入力してください（日本時間）。例：2026/11/20 20:00");
     return;
    }
    if(kind==="recruitment"){
     const next=await updateDraft(ctx.from.id,current.module,current.revision,"awaiting_tags",
       {...current.data,text:input,purposeCodes:[],placeCodes:[]});
     await ctx.reply("🎯 募集目的と📍場所/移動を選択してください。",tagPanel(next));
     return;
    }
    validateAnnouncement({ownerId:ctx.from.id,kind,text:input});
    data={...current.data,text:input};
   }
   const updated=await updateDraft(ctx.from.id,current.module,current.revision,"preview",data);
   await ctx.reply("プレビュー（まだ投稿していません）\n"+preview(current.module,updated));
   await destinationMenu(ctx,current.module,updated.revision);
  }catch(e){
   await ctx.reply(e instanceof Error?e.message:"入力内容を確認してください。");
  }
 });
 bot.action(/^post:linkcols:(\\d+):([123])$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]),cols=Number(ctx.match[2]) as 1|2|3;
  const d=await getDraft(ctx.from.id,"link");
  if(!d||d.step!=="preview"||d.revision!==rev){
   await ctx.answerCbQuery("古い選択です。/link で再開してください。");return;
  }
  const data={...d.data,columns:cols};
  const next=await updateDraft(ctx.from.id,"link",rev,"preview",data);
  await ctx.answerCbQuery("列数を保存しました");
  await ctx.editMessageText("公開前プレビュー\n"+preview("link",next));
  await destinationMenu(ctx,"link",next.revision);
 });
 bot.action(/^post:choose:(profile|room|announcement|link):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const module=ctx.match[1] as Module;
  const rev=Number(ctx.match[2]);const topicId=Number(ctx.match[3]);
  try{
   let text:string;
   if(module==="profile"){
    const p=await getProfile(ctx.from.id);
    if(!p||p.revision!==rev)throw new Error("プロフィールが更新されています。やり直してください。");
    text=renderPublicProfile(p);
   }else{
    const d=await getDraft(ctx.from.id,module as PostModule);
    if(!d||d.step!=="preview"||d.revision!==rev)throw new Error("下書きが更新されています。");
    text=preview(module,d);
   }
   const selected=await getVerifiedTopic(topicId,module as PostPurpose);
   await ctx.answerCbQuery();
   await ctx.editMessageText(
    "公開確認：\n"+text+"\n\n投稿先："+escapeProfileHtml(selected.board)+" / "+escapeProfileHtml(selected.title)+"\nこの宛先に公開する場合だけボタンを押してください。",
    {parse_mode:"HTML",...Markup.inlineKeyboard([
     [Markup.button.callback("✅ この内容を公開",`post:publish:${module}:${rev}:${topicId}`)],
     [Markup.button.callback("キャンセル（非公開のまま）","post:cancel")],
    ])}
   );
  }catch(e){await ctx.answerCbQuery("対象を確認できません。最初からやり直してください。");}
 });
 bot.action("post:cancel",async ctx=>{
  if(!privateDM(ctx))return;
  await ctx.answerCbQuery("公開しません");
  await ctx.editMessageText("公開は取り消しました。下書きは保存されています。");
 });
 bot.action(/^post:publish:(profile|room|announcement|link):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const module=ctx.match[1] as Module;
  const revision=Number(ctx.match[2]);const topicId=Number(ctx.match[3]);
  await ctx.answerCbQuery("公開処理を確認しています");
  try{
   let sourceId:string;let text:string;
   let buttons:ReadonlyArray<ReadonlyArray<{text:string;url:string}>>|undefined;
   if(module==="profile"){
    const p=await getProfile(ctx.from.id);
    if(!p||p.revision!==revision)throw new Error("プロフィールが更新されています。");
    sourceId=String(ctx.from.id);text=renderPublicProfile(p);
   }else{
    const draft=await getDraft(ctx.from.id,module);
    if(!draft||draft.step!=="preview"||draft.revision!==revision)
     throw new Error("投稿下書きが変更されています。");
    if(module==="link"){
     const payload=draft.data as LinkDraft;
     const link=await createLinkButton(ctx.from.id,revision,payload);
     sourceId=link.sourceId;
     text=renderLinkCard(payload);
     buttons=buttonGrid(payload).map(row=>row.map(b=>({text:b.label,url:b.url})));
    }else if(module==="room"){
     const name=String(draft.data.title);
     const url=draft.data.externalUrl?String(draft.data.externalUrl):undefined;
     const room=await createRoom(ctx.from.id,revision,name,url);
     text=preview(module,draft)+"\n"+
      "🔗 <a href=\""+room.joinUrl.replace(/&/g,"&amp;").replace(/"/g,"&quot;")+"\">ROOMへ参加</a>";
     // The adopted route is ROOM → Announcement → MPB, not ROOM → MPB.
     const linked=await createAnnouncement(ctx.from.id,revision,"announcement",
       text,undefined,[],[],Number(room.sourceId));
     sourceId=linked.sourceId;
    }else{
     const kind=draft.data.kind as AnnouncementKind;
     const value=String(draft.data.text);
     const eventAt=draft.data.eventAt?new Date(String(draft.data.eventAt)):undefined;
     const purposeCodes=Array.isArray(draft.data.purposeCodes)?draft.data.purposeCodes as string[]:[];
     const placeCodes=Array.isArray(draft.data.placeCodes)?draft.data.placeCodes as string[]:[];
     const ann=await createAnnouncement(ctx.from.id,revision,kind,value,eventAt,
       purposeCodes,placeCodes);
     sourceId=ann.sourceId;text=buildAnnouncementCard({ownerId:ctx.from.id,
       kind,text:value,eventAt,purposeCodes,placeCodes});
    }
   }
   const result=await publishPost(ctx.telegram,{
    sourceType:module==="room"?"announcement":module,
    destinationPurpose:module,sourceId,ownerId:ctx.from.id,revision,topicId,text,
    buttons,approved:true,
   });
   try{
    if(module==="profile")
     await recordProfilePublication(ctx.from.id,revision,result.chatId,result.threadId,result.messageId);
    else await markDraftPublished(ctx.from.id,module,revision);
   }catch{
    throw new Error("POST_SENT_SOURCE_SYNC_NEEDS_RECONCILE");
   }
   await ctx.editMessageText("✅ 投稿済み\n投稿先："+result.chatId+
    " / Topic "+result.threadId+"\n投稿ID："+result.messageId);
  }catch(e){
   const msg=e instanceof Error?e.message:"投稿失敗";
   await ctx.reply(msg==="PUBLISH_NEEDS_RECONCILE"||msg==="POST_SENT_SOURCE_SYNC_NEEDS_RECONCILE"?
    "投稿と元データの照合が必要です。重複投稿防止のため自動再送は行いません。":
    "投稿を確認できませんでした："+msg);
  }
 });
}
