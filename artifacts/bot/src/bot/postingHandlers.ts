import { Markup, type Telegraf, type Telegram } from "telegraf";
import {pool} from "../db/index.js";
import { getProfile, recordProfilePublication } from "../services/profileRepository.js";
import { renderPublicProfile, escapeProfileHtml } from "../services/profileCore.js";
import {makeProfileViewerButtons,existingPublishedProfileUrl} from "../services/profilePublicView.js";
import {revisePublishedProfile} from "../services/profilePublicationUpdate.js";
import { listVerifiedTopics, getVerifiedTopic } from "../services/postingDelivery.js";
import { publishPost } from "../services/publishService.js";
import { buildRoomCard, buildAnnouncementCard, validateAnnouncement,
  validateRoom,assertHttpsMeetingUrl,parseJstDateTime,parseRoomDetails,type AnnouncementKind } from "../services/postingDomain.js";
import { beginDraft,getDraft,getWaitingDraft,updateDraft,bindDraftScreen,createRoom,createLinkButton,markRoomDraftSaved,
 createAnnouncement,markDraftPublished,markPostSourcePublished,saveRoomEditorDraft,saveAnnouncementEditorDraft,type PostModule,type EditorDraft } from "../services/publicPostRepository.js";
import {BOARD_KEYS,BOARD_TITLES,type BoardKey,type PostPurpose} from "../services/topicRouting.js";
import { currentMenuOrigin } from "../services/menuOriginRepository.js";
import { currentTopicDmEntry,assertTopicDmEntryDestination } from "../services/topicDmEntry.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import { PURPOSE_TAGS, validateAnnouncementTags, normalizePlaceCodes } from "../services/announcementTags.js";
import {parseLinkInput,renderLinkCard,buttonGrid,type LinkDraft} from "../services/linkButtonDomain.js";
import {makeApplicationLink} from "../services/applicationLinks.js";
import {makeRoomJoinLink} from "../services/roomJoinLinks.js";
import {updateRoomState} from "../services/roomLifecycle.js";
import {showWizardScreen,removeUserWizardInput,type WizardKeyboard} from "../services/dmWizardScreen.js";

async function showPostScreen(
 telegram:Telegram,userId:number,draft:EditorDraft,text:string,keyboard?:WizardKeyboard,
):Promise<void>{
 const old=typeof draft.data.screenMessageId==="number"?draft.data.screenMessageId:undefined;
 const shown=await showWizardScreen(telegram,userId,old,text,keyboard);
 if(shown.messageId!==old)
  await bindDraftScreen(userId,draft.module,draft.revision,shown.messageId);
}
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
  const description=String(draft.data.description||"");
  const externalUrl=draft.data.externalUrl?String(draft.data.externalUrl):undefined;
  validateRoom({ownerId:1,name:title,mode:externalUrl?"external":"jitsi",
   externalUrl,status:"draft"});
  const when=draft.data.startAt?new Date(String(draft.data.startAt)):null;
  return ["🎬 ROOM："+escapeProfileHtml(title),
    escapeProfileHtml(description),
    "方式："+(externalUrl?"URL持込":"無料Jitsi"),
    "開催："+(when?when.toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})+"（日本時間）":"今すぐ"),
    "参加："+(draft.data.visibility==="public"?"自由参加":"応募受付"),
    "プロフ連携："+(draft.data.profileLinked?"あり":"なし"),
    "状態："+(when?"📅 予告中":"🔴 LIVE中")].join("\n");
  }
 const kind=draft.data.kind as AnnouncementKind;
 return buildAnnouncementCard(validateAnnouncement({ownerId:1,kind,
  text:String(draft.data.text||""),
  eventAt:draft.data.eventAt?new Date(String(draft.data.eventAt)):undefined,
  purposeCodes:Array.isArray(draft.data.purposeCodes)?draft.data.purposeCodes as string[]:[],
  placeCodes:Array.isArray(draft.data.placeCodes)?draft.data.placeCodes as string[]:[]}));
}
async function destinationMenu(ctx:{reply:Function;telegram:Telegram;from?:{id:number}},module:Module,revision:number,board?:BoardKey):Promise<void>{
 const pinned=ctx.from?.id?await currentTopicDmEntry(ctx.from.id):null;
 const options=(await listVerifiedTopics(module as PostPurpose))
  .filter(x=>(!board||x.board===board)&&
   (!pinned||(x.chatId===pinned.chatId&&x.threadId===pinned.threadId)));
 if(!options.length){
  const message="投稿先の実Topic IDがまだ確認されていません。管理者によるトピック接続後に公開できます。下書きは保持しています。";
  const draft=ctx.from&&module!=="profile"?await getDraft(ctx.from.id,module as PostModule):null;
  if(draft&&ctx.from)await showPostScreen(ctx.telegram,ctx.from.id,draft,
   module==="link"?message+"\n\n"+preview("link",draft):message,
   module==="link"?linkPreviewKeyboard(draft):undefined);
  else await ctx.reply(message);
  return;
 }
 const origin=pinned??(ctx.from?.id?await currentMenuOrigin(ctx.from.id):null);
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
 const rows=sorted.slice(0,30).map(t=>[
   Markup.button.callback((matched?.id===t.id?"📍 ":"")+BOARD_TITLES[t.board]+" / "+t.title,
    `post:choose:${module}:${revision}:${t.id}`)]);
 if(module==="link")rows.push([Markup.button.callback("↩ プレビューに戻る",
  `post:link:back:${revision}`)]);
 const keyboard=Markup.inlineKeyboard(rows);
 const draft=ctx.from&&module!=="profile"?await getDraft(ctx.from.id,module as PostModule):null;
 if(draft&&ctx.from)await showPostScreen(ctx.telegram,ctx.from.id,draft,prefix+"\n投稿先を選択してください。まだ公開しません。",keyboard);
 else await ctx.reply(prefix+"\n投稿先を選択してください。まだ公開しません。",keyboard);
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
function roomOptions(d:EditorDraft){
 const revision=d.revision;
 const external=Boolean(d.data.externalUrl);
 const publicJoin=d.data.visibility==="public";
 return Markup.inlineKeyboard([
  [Markup.button.callback(external?"▫️ 無料Jitsi":"✅ 無料Jitsi",
    `room:mode:${revision}:jitsi`),
   Markup.button.callback(external?"✅ URL持込":"▫️ URL持込",
    `room:mode:${revision}:external`)],
  [Markup.button.callback(publicJoin?"✅ 自由参加":"▫️ 自由参加",
    `room:joinmode:${revision}:public`),
   Markup.button.callback(!publicJoin?"✅ 応募受付":"▫️ 応募受付",
    `room:joinmode:${revision}:approved_only`)],
  [Markup.button.callback("📝 タイトル・説明を修正",`room:edit:${revision}`),
   Markup.button.callback(d.data.profileLinked?"✅ プロフ連携":"▫️ プロフ連携",
    `room:profile:${revision}`)],
  [Markup.button.callback("▶ 開始する",`room:plan:${revision}:now`),
   Markup.button.callback("📅 予告する",`room:plan:${revision}:scheduled`)],
  [Markup.button.callback("下書き保存",`room:save:${revision}`),
   Markup.button.callback("キャンセル",`room:cancel:${revision}`)],
 ]);
}
async function roomPreviewScreen(telegram:Telegram,userId:number,d:EditorDraft):Promise<void>{
 await showPostScreen(telegram,userId,d,
  "ROOM内容（まだ公開していません）\n"+preview("room",d),
  roomOptions(d));
}
async function roomBoardMenu(telegram:Telegram,userId:number,d:EditorDraft):Promise<void>{
 await showPostScreen(telegram,userId,d,"投稿先グループを選択してください。",
  Markup.inlineKeyboard([BOARD_KEYS.map((key,index)=>
   Markup.button.callback(BOARD_TITLES[key],`room:board:${d.revision}:${index}`))]));
}
/** Entry shared by /room and the verified ROOM topic menu. */
export async function startRoomEditor(telegram:Telegram,userId:number,screenId?:number):Promise<void>{
 const existing=await getDraft(userId,"room");
 if(screenId&&existing){
  await bindDraftScreen(userId,"room",existing.revision,screenId);
  existing.data.screenMessageId=screenId;
 }
 if(existing?.step==="saved"&&existing.data.title&&existing.data.description){
  const {savedTemplate:_unused,...template}=existing.data;
  const resumed=await updateDraft(userId,"room",existing.revision,"preview",
   {...template,savedTemplate:template,startAt:null});
  await roomPreviewScreen(telegram,userId,resumed);
  return;
 }
 if(existing&&["preview","awaiting_text","awaiting_datetime","awaiting_room_url"].includes(existing.step)){
  if(existing.step==="preview"){
   await roomPreviewScreen(telegram,userId,existing);
  }else if(existing.step==="awaiting_datetime"){
   await showPostScreen(telegram,userId,existing,
    "📅 予告日時を日本時間で1通送信してください。例：2026/11/20 20:00");
  }else if(existing.step==="awaiting_room_url"){
   await showPostScreen(telegram,userId,existing,
    "外部ROOMのHTTPS参加URLを1通で送信してください。");
  }else{
   await showPostScreen(telegram,userId,existing,
    "🎬 ROOM作成\n1行目：タイトル（必須）\n2行目以降：説明文（必須）\n\n例：\n今夜の交流\n気軽にお話ししましょう。");
  }
  return;
 }
 const draft=await beginDraft(userId,"room","awaiting_text",
  {visibility:"approved_only",profileLinked:false,...(screenId?{screenMessageId:screenId}:{})});
 await showPostScreen(telegram,userId,draft,
  "🎬 ROOM作成\n1行目：タイトル（必須）\n2行目以降：説明文（必須）\n\n例：\n今夜の交流\n気軽にお話ししましょう。");
}
/** LinkButton uses the same DM draft, owner and verified topic as other posts. */
export function linkPreviewKeyboard(d:EditorDraft):WizardKeyboard{
 const rev=d.revision;
 return Markup.inlineKeyboard([
  [1,2,3].map(i=>Markup.button.callback((d.data.columns===i?"✅ ":"▫️ ")+i+"列",
    "post:linkcols:"+rev+":"+i)),
  [Markup.button.callback("📝 内容を修正","post:link:edit:"+rev),
   Markup.button.callback("キャンセル","post:link:cancel:"+rev)],
 ]);
}
export async function startLinkEditor(telegram:Telegram,userId:number,screenId?:number):Promise<void>{
 const prior=await getDraft(userId,"link");
 if(screenId&&prior){
  await bindDraftScreen(userId,"link",prior.revision,screenId);
  prior.data.screenMessageId=screenId;
 }
 // Reopening /link must not erase a still-private, valid editor. Other
 // draft modules and published receipts are never touched.
 if(prior?.step==="preview"){
  await showPostScreen(telegram,userId,prior,"公開前プレビュー\n"+preview("link",prior)+
   "\n\nボタンの表示列数を選択してください。",linkPreviewKeyboard(prior));
  return;
 }
 const draft=prior?.step==="awaiting_text"?prior:
  await beginDraft(userId,"link","awaiting_text",screenId?{screenMessageId:screenId}:{});
 await showPostScreen(telegram,userId,draft,
  "🔗 1行目に本文、2行目以降に「表示名 | https://URL」を1ボタン1行で送ってください。\n列数は次の画面で1〜3列から選べます。短縮URL・HTTP・ローカル宛先は拒否します。",
  Markup.inlineKeyboard([[Markup.button.callback("キャンセル",
   "post:link:cancel:"+draft.revision)]]));
}
/** One shared Bot DM message for the approved 告知/予告 layout. */
export function announcementPanel(d:EditorDraft):WizardKeyboard{
 const rev=d.revision;
 const kind=d.data.kind==="preview"?"preview":"announcement";
 return Markup.inlineKeyboard([
  [Markup.button.callback(kind==="announcement"?"✅ 📢 告知":"▫️ 📢 告知",
    `post:announce:kind:${rev}:announcement`),
   Markup.button.callback(kind==="preview"?"✅ 📅 予告":"▫️ 📅 予告",
    `post:announce:kind:${rev}:preview`)],
  [Markup.button.callback("📝 本文編集",`post:announce:edit:${rev}`),
   Markup.button.callback("📅 日時・受付",`post:announce:date:${rev}`)],
  [Markup.button.callback(d.data.profileLinked?"✅ 🔗 プロフ連携":"▫️ 🔗 プロフ連携",
    `post:announce:profile:${rev}`),
   Markup.button.callback("📍 投稿先",`post:announce:destination:${rev}`)],
  [Markup.button.callback("✅ 投稿",typeof d.data.topicId==="number"?
   `post:publish:announcement:${rev}:${d.data.topicId}`:`post:announce:publish:${rev}`),
   Markup.button.callback("下書き保存",`post:announce:save:${rev}`)],
  [Markup.button.callback("キャンセル",`post:announce:cancel:${rev}`)],
 ]);
}
export function announcementSummary(d:EditorDraft):string{
 const kind=d.data.kind==="preview"?"preview":"announcement";
 const value=String(d.data.text||"").trim();
 const date=d.data.eventAt?new Date(String(d.data.eventAt)):undefined;
 const message=value&&!(kind==="preview"&&!date)?
  buildAnnouncementCard({ownerId:1,kind,text:value,eventAt:date}):
  value?(kind==="preview"?"📅 予告":"📢 告知")+"\n"+escapeProfileHtml(value)+"\n開催日時：未指定":
  (kind==="preview"?"📅 予告":"📢 告知")+"\n本文を1通で入力してください。";
 return "📢 告知/予告\n"+message+
  "\n投稿先："+(typeof d.data.destinationLabel==="string"?d.data.destinationLabel:"未選択")+
  "\nプロフ連携："+(d.data.profileLinked?"あり":"なし")+
  "\n\n必要な項目だけ選択して編集できます。";
}
async function announcementScreen(telegram:Telegram,userId:number,d:EditorDraft):Promise<void>{
 await showPostScreen(telegram,userId,d,announcementSummary(d),announcementPanel(d));
}
async function announcementDestinationPicker(telegram:Telegram,userId:number,d:EditorDraft):Promise<void>{
 await showPostScreen(telegram,userId,d,announcementSummary(d)+"\n\n公開先を選択してください。",
  Markup.inlineKeyboard([
   [Markup.button.callback("📍 検証済みTopicから選択",`post:announce:topics:${d.revision}`)],
   [Markup.button.callback("↩ 戻る",`post:announce:back:${d.revision}`)]
  ]));
}
/** Announcement is selected by its menu, not by an extra mandatory kind page. */
export async function startAnnouncementEditor(telegram:Telegram,userId:number,screenId?:number):Promise<void>{
 const existing=await getDraft(userId,"announcement");
 if(screenId&&existing){
  await bindDraftScreen(userId,"announcement",existing.revision,screenId);
  existing.data.screenMessageId=screenId;
 }
 if(existing?.step==="saved"&&existing.data.kind!=="recruitment"){
  const {savedTemplate:_previous,...template}=existing.data;
  const resumed=await updateDraft(userId,"announcement",existing.revision,
   String(template.text||"").trim()?"preview":"awaiting_text",
   {...template,savedTemplate:template});
  await announcementScreen(telegram,userId,resumed);
  return;
 }
 if(existing&&["preview","awaiting_text","awaiting_datetime"].includes(existing.step)&&
    existing.data.kind!=="recruitment"){
  if(existing.step==="awaiting_datetime"){
   await showPostScreen(telegram,userId,existing,
    "📅 日時を日本時間で1通送信してください。例：2026/11/20 20:00",
    Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",
     `post:announce:back:${existing.revision}`)]]));
  }else await announcementScreen(telegram,userId,existing);
  return;
 }
 const draft=await beginDraft(userId,"announcement","awaiting_text",
  {kind:"announcement",profileLinked:false,...(screenId?{screenMessageId:screenId}:{})});
 await announcementScreen(telegram,userId,draft);
}
export function registerPostingHandlers(bot:Telegraf):void{
 bot.command("publishprofile",async ctx=>{
  if(!privateDM(ctx))return;
  const p=await getProfile(ctx.from.id);
  if(!p){await ctx.reply("先にプロフを登録してください。投稿メニューまたは操作説明から進められます。");return;}
  await destinationMenu(ctx,"profile",p.revision);
 });
 bot.command("room",async ctx=>{
  if(!privateDM(ctx))return;
  await startRoomEditor(ctx.telegram,ctx.from.id);
 });
 bot.action(/^room:(mode|joinmode|profile|edit|plan|board|cancel):(\d+)(?::([a-z_0-9]+))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]),choice=ctx.match[3]||"";
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.step!=="preview"||d.revision!==rev){
   await ctx.answerCbQuery("操作が古くなりました。投稿メニューから再度お試しください。");return;
  }
  try{
   if(op==="mode"){
    if(choice!=="jitsi"&&choice!=="external")throw new Error("ROOM_MODE_INVALID");
    if(choice==="external"){
     const next=await updateDraft(ctx.from.id,"room",rev,"awaiting_room_url",d.data);
     await ctx.answerCbQuery();
     await showPostScreen(ctx.telegram,ctx.from.id,next,
      "外部ROOMのHTTPS参加URLを1通で送信してください。");
     return;
    }
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,externalUrl:null});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="joinmode"){
    if(choice!=="public"&&choice!=="approved_only")throw new Error("ROOM_VISIBILITY_INVALID");
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",{...d.data,visibility:choice});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="profile"){
    if(!d.data.profileLinked&&!await existingPublishedProfileUrl(ctx.from.id)){
     await ctx.answerCbQuery("公開済みのプロフィールがありません。");return;
    }
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,profileLinked:!d.data.profileLinked});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="edit"){
    const next=await updateDraft(ctx.from.id,"room",rev,"awaiting_text",d.data);
    await ctx.answerCbQuery();
    await showPostScreen(ctx.telegram,ctx.from.id,next,
     "タイトルと説明文を再入力してください。\n1行目：タイトル／2行目以降：説明文");
   }else if(op==="plan"){
    if(choice==="scheduled"){
     const next=await updateDraft(ctx.from.id,"room",rev,"awaiting_datetime",
      {...d.data,startAt:null});
     await ctx.answerCbQuery();
     await showPostScreen(ctx.telegram,ctx.from.id,next,
      "予告日時を日本時間で1通送信してください。例：2026/11/20 20:00");
    }else if(choice==="now"){
     const next=await updateDraft(ctx.from.id,"room",rev,"preview",
      {...d.data,startAt:null});
     await ctx.answerCbQuery();await roomBoardMenu(ctx.telegram,ctx.from.id,next);
    }else throw new Error("ROOM_PLAN_INVALID");
   }else if(op==="board"){
    const boardIndex=Number(choice);
    if(!Number.isInteger(boardIndex)||boardIndex<0||boardIndex>=BOARD_KEYS.length)
     throw new Error("ROOM_BOARD_INVALID");
    await ctx.answerCbQuery();
    await destinationMenu(ctx,"room",rev,BOARD_KEYS[boardIndex]);
   }else if(op==="cancel"){
    const template=d.data.savedTemplate;
    const previous=template&&typeof template==="object"&&!Array.isArray(template)?
     template as Record<string,unknown>:null;
    await updateDraft(ctx.from.id,"room",rev,previous?"saved":"cancelled",
     previous??{cancelled:true});
    await ctx.answerCbQuery("ROOMの作成を中止しました");
    await ctx.editMessageText("ROOM作成をキャンセルしました。"+
     (previous?"\n以前に保存した下書きは保持されています。投稿メニューから再開できます。":""));
   }
  }catch{
   await ctx.answerCbQuery("操作できません。投稿メニューから再度お試しください。");
  }
 });
 bot.command("link",async ctx=>{
  if(!privateDM(ctx))return;
  await startLinkEditor(ctx.telegram,ctx.from.id);
 });
 bot.command("announce",async ctx=>{
  if(!privateDM(ctx))return;
  await startAnnouncementEditor(ctx.telegram,ctx.from.id);
 });
 bot.action(/^post:announce:(kind|edit|date|profile|destination|topics|back|publish|save|cancel):(\d+)(?::(announcement|preview))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]);
  const kindChoice=ctx.match[3];
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.revision!==rev||!["preview","awaiting_text","awaiting_datetime"].includes(d.step)||
     d.data.kind==="recruitment"){
   await ctx.answerCbQuery("古い操作です。投稿メニューから再度お試しください。");return;
  }
  try{
   if(op==="kind"){
    if(kindChoice!=="announcement"&&kindChoice!=="preview")throw new Error("ANNOUNCEMENT_KIND_INVALID");
    const next=await updateDraft(ctx.from.id,"announcement",rev,d.step,{
     ...d.data,kind:kindChoice,eventAt:kindChoice==="announcement"?null:d.data.eventAt});
    await ctx.answerCbQuery();await announcementScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="edit"){
    const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_text",d.data);
    await ctx.answerCbQuery();
    await showPostScreen(ctx.telegram,ctx.from.id,next,
     "📝 告知本文を1通で送信してください。元の入力項目は保持します。",
     Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",
      `post:announce:back:${next.revision}`)]]));
   }else if(op==="date"){
    const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_datetime",d.data);
    await ctx.answerCbQuery();
    await showPostScreen(ctx.telegram,ctx.from.id,next,
     "📅 日時を日本時間で1通送信してください。例：2026/11/20 20:00",
     Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",
      `post:announce:back:${next.revision}`)]]));
   }else if(op==="profile"){
    if(!d.data.profileLinked&&!await existingPublishedProfileUrl(ctx.from.id)){
     await ctx.answerCbQuery("利用可能な公開プロフィールがありません。");return;
    }
    const next=await updateDraft(ctx.from.id,"announcement",rev,d.step,
     {...d.data,profileLinked:!d.data.profileLinked});
    await ctx.answerCbQuery();await announcementScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="destination"||op==="publish"){
    if(op==="publish"&&(!String(d.data.text||"").trim()||
       (d.data.kind==="preview"&&!d.data.eventAt))){
     await ctx.answerCbQuery("本文と必要な日時を入力してください。");return;
    }
    await ctx.answerCbQuery();
    await announcementDestinationPicker(ctx.telegram,ctx.from.id,d);
   }else if(op==="topics"){
    if(!String(d.data.text||"").trim()||
       (d.data.kind==="preview"&&!d.data.eventAt)){
     await ctx.answerCbQuery("本文と必要な開催日時を入力してください。");return;
    }
    const current=await getDraft(ctx.from.id,"announcement");
    if(!current||current.revision!==rev||current.step!=="preview"){
     await ctx.answerCbQuery("本文の入力を完了してから選択してください。");return;
    }
    await ctx.answerCbQuery();
    await destinationMenu(ctx,"announcement",rev);
   }else if(op==="back"){
    const next=await updateDraft(ctx.from.id,"announcement",rev,
     String(d.data.text||"").trim()?"preview":"awaiting_text",d.data);
    await ctx.answerCbQuery();await announcementScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="save"){
    await saveAnnouncementEditorDraft(ctx.from.id,rev);
    await ctx.answerCbQuery("下書きを保存しました");
    await ctx.editMessageText("✅ 告知/予告を非公開保存しました。投稿メニューから再開できます。");
   }else if(op==="cancel"){
    const old=d.data.savedTemplate;
    const saved=old&&typeof old==="object"&&!Array.isArray(old)?
     old as Record<string,unknown>:null;
    await updateDraft(ctx.from.id,"announcement",rev,saved?"saved":"cancelled",
     saved??{cancelled:true});
    await ctx.answerCbQuery("作成をキャンセルしました");
    await ctx.editMessageText("作成をキャンセルしました。公開済み投稿は変更していません。"+
     (saved?"\n以前の保存済み下書きは残っています。":""));
   }
  }catch{
   await ctx.answerCbQuery("操作できません。投稿メニューから再度お試しください。");
  }
 });
 bot.action(/^post:kind:(\d+):(announcement|preview|recruitment)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]);const kind=ctx.match[2] as AnnouncementKind;
  const draft=await getDraft(ctx.from.id,"announcement");
  if(!draft||draft.revision!==rev||draft.step!=="awaiting_kind"){
   await ctx.answerCbQuery("古い操作です。投稿メニューから再度お試しください。");return;
  }
  const updated=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_text",{...draft.data,kind});
  await ctx.answerCbQuery();
  await showPostScreen(ctx.telegram,ctx.from.id,updated,kind==="preview"?
   "予告文を送ってください。開催日時は公開前に別途必要です。":
   "本文を1通で送ってください。公開前に内容と投稿先を確認します。");
 });
 bot.action(/^post:tag:(\d+):(\d{1,2})$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]), i=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.step!=="awaiting_tags"||d.revision!==rev||i>=PURPOSE_TAGS.length){
   await ctx.answerCbQuery("古い操作です。投稿メニューから再度お試しください。");return;
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
   await ctx.answerCbQuery("古い操作です。投稿メニューから再度お試しください。");return;
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
   await ctx.answerCbQuery("古い操作です。投稿メニューから再度お試しください。");return;
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
  const owner=await currentDmTextOwner(ctx.from.id);
  if(owner!=="room"&&owner!=="announcement"&&owner!=="link")return next();
  const current=await getWaitingDraft(ctx.from.id);
  if(!current||current.module!==owner)return next();
  const deleted=await removeUserWizardInput(ctx.telegram,ctx.chat.id,ctx.message.message_id);
  const warning=deleted?"":"\n⚠️ 入力メッセージを削除できませんでした。手動で削除してください。";
  const render=(d:EditorDraft,text:string,keyboard?:WizardKeyboard)=>
    showPostScreen(ctx.telegram,ctx.from.id,d,text+warning,keyboard);
  const input=ctx.message.text.trim();
  try{
   let data:Record<string,unknown>;
   if(current.step==="awaiting_datetime"){
    const date=parseJstDateTime(input);
    if(current.module==="room"){
     const updated=await updateDraft(ctx.from.id,"room",current.revision,"preview",
      {...current.data,startAt:date.toISOString()});
     await roomBoardMenu(ctx.telegram,ctx.from.id,updated);
     return;
    }
    data={...current.data,eventAt:date.toISOString()};
    validateAnnouncement({ownerId:ctx.from.id,
      kind:data.kind as AnnouncementKind,text:String(data.text),eventAt:date});
    const updated=await updateDraft(ctx.from.id,current.module,current.revision,"preview",data);
    if(current.module==="announcement"&&data.kind!=="recruitment"){
     await announcementScreen(ctx.telegram,ctx.from.id,updated);
    }else await destinationMenu(ctx,current.module,updated.revision);
    return;
   }
   if(current.module==="room"&&current.step==="awaiting_room_url"){
    const externalUrl=assertHttpsMeetingUrl(input);
    const updated=await updateDraft(ctx.from.id,"room",current.revision,"preview",
     {...current.data,externalUrl});
    await roomPreviewScreen(ctx.telegram,ctx.from.id,updated);
    return;
   }
   if(current.module==="link"){
    const parsed=parseLinkInput(input);
    const updated=await updateDraft(ctx.from.id,"link",current.revision,"preview",
      {...current.data,...parsed,columns:[1,2,3].includes(Number(current.data.columns))?current.data.columns:1});
    await render(updated,"公開前プレビュー\n"+preview("link",updated)+
      "\n\nボタンの表示列数を選択してください。",
      linkPreviewKeyboard(updated));
    return;
   }
   if(current.module==="room"){
    const {title,description}=parseRoomDetails(input);
    const externalUrl=current.data.externalUrl?String(current.data.externalUrl):undefined;
    validateRoom({ownerId:ctx.from.id,name:title,mode:externalUrl?"external":"jitsi",
     externalUrl,status:"draft"});
    data={...current.data,title,description};
   }else{
    if(!current.data.kind)throw new Error("投稿種別が未選択です。");
    const kind=current.data.kind as AnnouncementKind;
    if(kind==="preview"&&!current.data.eventAt){
     const next=await updateDraft(ctx.from.id,current.module,current.revision,"preview",
       {...current.data,text:input});
     await announcementScreen(ctx.telegram,ctx.from.id,next);
     return;
    }
    if(kind==="recruitment"){
     const next=await updateDraft(ctx.from.id,current.module,current.revision,"awaiting_tags",
       {...current.data,text:input,purposeCodes:[],placeCodes:[]});
     await render(next,"🎯 募集目的と📍場所/移動を選択してください。",tagPanel(next));
     return;
    }
    validateAnnouncement({ownerId:ctx.from.id,kind,text:input});
    data={...current.data,text:input};
   }
   const updated=await updateDraft(ctx.from.id,current.module,current.revision,"preview",data);
   if(current.module==="room"){
    await roomPreviewScreen(ctx.telegram,ctx.from.id,updated);
   }else if(current.module==="announcement"&&updated.data.kind!=="recruitment"){
    await announcementScreen(ctx.telegram,ctx.from.id,updated);
   }else{
    await destinationMenu(ctx,current.module,updated.revision);
   }
  }catch(e){
   if(e instanceof Error&&e.message==="POST_DRAFT_STALE")throw e;
   const errorText=(e instanceof Error?e.message:"入力内容を確認してください。")+
     "\n内容を修正して、もう一度送信してください。";
   await render(current,errorText,current.module==="link"?
    Markup.inlineKeyboard([
     ...(Array.isArray(current.data.buttons)&&current.data.buttons.length?
       [[Markup.button.callback("↩ プレビューに戻る",
        "post:link:back:"+current.revision)]]:[]),
     [Markup.button.callback("キャンセル","post:link:cancel:"+current.revision)]
    ]):undefined);
  }
 });
 bot.action(/^room:save:(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]);
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.step!=="preview"||d.revision!==rev){
   await ctx.answerCbQuery("古い操作です。投稿メニューから再度お試しください。");
   return;
  }
  try{
   parseRoomDetails(String(d.data.title||"")+"\n"+String(d.data.description||""));
   await saveRoomEditorDraft(ctx.from.id,rev);
   await ctx.answerCbQuery("下書き保存済み");
   await ctx.editMessageText("✅ ROOMのタイトル・説明・設定を非公開保存しました。\n投稿メニューから再利用できます。");
  }catch{await ctx.answerCbQuery("保存に失敗しました。投稿メニューから再度お試しください。");}
 });
 bot.action(/^post:link:(edit|cancel|back):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"link");
  if(!d||d.revision!==rev||!["awaiting_text","preview"].includes(d.step)){
   await ctx.answerCbQuery("古い操作です。/link から再開してください。");return;
  }
  if(op==="cancel"){
   await updateDraft(ctx.from.id,"link",rev,"cancelled",{cancelled:true});
   await ctx.answerCbQuery("作成をキャンセルしました");
   await ctx.editMessageText("🔗 ボタン作成をキャンセルしました。公開済みの投稿は変更していません。");
   return;
  }
  if(op==="edit"){
   if(d.step!=="preview"){
    await ctx.answerCbQuery("先にURLと表示名を入力してください。");return;
   }
   const next=await updateDraft(ctx.from.id,"link",rev,"awaiting_text",d.data);
   await ctx.answerCbQuery();
   await showPostScreen(ctx.telegram,ctx.from.id,next,
    "📝 本文とリンクをまとめて再入力してください。\n1行目：本文\n2行目以降：表示名 | https://URL\n以前の入力は確定するまで保持します。",
    Markup.inlineKeyboard([[Markup.button.callback("↩ プレビューに戻る",
     "post:link:back:"+next.revision)],
     [Markup.button.callback("キャンセル","post:link:cancel:"+next.revision)]]));
   return;
  }
  if(!Array.isArray(d.data.buttons)||!d.data.buttons.length){
   await ctx.answerCbQuery("先にリンクを入力してください。");return;
  }
  const next=d.step==="awaiting_text"?
   await updateDraft(ctx.from.id,"link",rev,"preview",d.data):d;
  await ctx.answerCbQuery();
  await showPostScreen(ctx.telegram,ctx.from.id,next,"公開前プレビュー\n"+preview("link",next)+
   "\n\nボタンの表示列数を選択してください。",linkPreviewKeyboard(next));
 });
 bot.action(/^post:linkcols:(\d+):([123])$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]),cols=Number(ctx.match[2]) as 1|2|3;
  const d=await getDraft(ctx.from.id,"link");
  if(!d||d.step!=="preview"||d.revision!==rev){
   await ctx.answerCbQuery("古い選択です。/link で再開してください。");return;
  }
  const data={...d.data,columns:cols};
  const next=await updateDraft(ctx.from.id,"link",rev,"preview",data);
  await ctx.answerCbQuery("列数を保存しました");
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
   await assertTopicDmEntryDestination(ctx.from.id,selected.chatId,selected.threadId);
   if(module==="announcement"){
    const d=await getDraft(ctx.from.id,"announcement");
    if(!d||d.step!=="preview"||d.revision!==rev)throw new Error("ANNOUNCEMENT_DRAFT_STALE");
    if(d.data.kind==="announcement"||d.data.kind==="preview"){
     const next=await updateDraft(ctx.from.id,"announcement",rev,"preview",
      {...d.data,topicId,destinationLabel:BOARD_TITLES[selected.board]+" / "+selected.title});
     await ctx.answerCbQuery();
     await announcementScreen(ctx.telegram,ctx.from.id,next);
     return;
    }
   }
   await ctx.answerCbQuery();
   await ctx.editMessageText(
    "公開確認：\n"+text+"\n\n投稿先："+escapeProfileHtml(selected.board)+" / "+escapeProfileHtml(selected.title)+
    (module==="profile"?"\n画像・動画の登録がある場合、公開後は閲覧者が［画像/動画］を押すと表示できます。自己PR・Like/Loveも公開内容に含まれます。":"")+
    "\nこの宛先に公開する場合だけボタンを押してください。",
    {parse_mode:"HTML",...Markup.inlineKeyboard([
     [Markup.button.callback("✅ この内容を公開",`post:publish:${module}:${rev}:${topicId}`)],
     [Markup.button.callback("キャンセル（非公開のまま）",`post:cancel:${module}:${rev}`)],
    ])}
   );
  }catch(e){await ctx.answerCbQuery("対象を確認できません。最初からやり直してください。");}
 });
 bot.action(/^post:cancel:(profile|room|announcement|link):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const module=ctx.match[1] as Module;
  const rev=Number(ctx.match[2]);
  if(module==="profile"){
   const profile=await getProfile(ctx.from.id);
   if(!profile||profile.revision!==rev){
    await ctx.answerCbQuery("古い操作です。公開前の画面を開き直してください。");return;
   }
  }else{
   const d=await getDraft(ctx.from.id,module);
   if(!d||d.revision!==rev||d.step!=="preview"){
    await ctx.answerCbQuery("古い操作です。投稿メニューから再度お試しください。");return;
   }
   // Preserve all private draft fields, but advance the revision so an old
   // confirmation tap cannot publish after the owner cancelled it.
   await updateDraft(ctx.from.id,module,rev,"preview",d.data);
  }
  await ctx.answerCbQuery("公開しません");
  await ctx.editMessageText("公開は取り消しました。"+
    (module==="profile"?"保存済みのプロフィールは変更していません。":
     "入力した下書きは保存されています。"));
 });
 bot.action(/^post:publish:(profile|room|announcement|link):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const module=ctx.match[1] as Module;
  const revision=Number(ctx.match[2]);const topicId=Number(ctx.match[3]);
  await ctx.answerCbQuery("公開処理を確認しています");
  try{
   const destination=await getVerifiedTopic(topicId,module as PostPurpose);
   await assertTopicDmEntryDestination(ctx.from.id,destination.chatId,destination.threadId);
   let sourceId:string;let text:string;
   let hostJoinUrl:string|null=null;
   let isScheduledRoom=false;
   let buttons:ReadonlyArray<ReadonlyArray<{text:string;url:string}>>|undefined;
   if(module==="profile"){
    const p=await getProfile(ctx.from.id);
    if(!p||p.revision!==revision)throw new Error("プロフィールが更新されています。");
    // Existing destination: update the same Telegram message instead of
    // creating a duplicate. A stale or ambiguous state fails closed.
    const prior=await revisePublishedProfile(ctx.telegram,ctx.from.id,p,topicId);
    if(prior){
     await ctx.editMessageText((prior.updated?"✅ 公開元の投稿を更新しました。":"✅ この内容は公開元に反映済みです。")+
      "\\n投稿先："+prior.chatId+" / Topic "+prior.threadId+"\\n投稿ID："+prior.messageId);
     return;
    }
    sourceId=String(ctx.from.id);text=renderPublicProfile(p);
    buttons=await makeProfileViewerButtons(ctx.from.id,revision,topicId);
   }else{
    const draft=await getDraft(ctx.from.id,module);
    if(!draft||draft.step!=="preview"||draft.revision!==revision)
     throw new Error("投稿下書きが変更されています。");
    if(module==="announcement"&&(draft.data.kind==="announcement"||draft.data.kind==="preview")&&
      draft.data.topicId!==topicId)
      throw new Error("ANNOUNCEMENT_DESTINATION_STALE");
    if(module==="link"){
     const payload=draft.data as LinkDraft;
     const link=await createLinkButton(ctx.from.id,revision,payload);
     sourceId=link.sourceId;
     text=renderLinkCard(payload);
     buttons=buttonGrid(payload).map(row=>row.map(b=>({text:b.label,url:b.url})));
    }else if(module==="room"){
     const title=String(draft.data.title||"");
     const description=String(draft.data.description||"");
     parseRoomDetails(title+"\n"+description);
     const externalUrl=draft.data.externalUrl?String(draft.data.externalUrl):undefined;
     const startAt=draft.data.startAt?new Date(String(draft.data.startAt)):undefined;
     const visibility=draft.data.visibility==="public"?"public":"approved_only";
     const room=await createRoom(ctx.from.id,revision,title,externalUrl,{
      description,scheduledAt:startAt,visibility});
     const roomId=Number(room.sourceId);
     hostJoinUrl=room.joinUrl;
     isScheduledRoom=Boolean(startAt);
     await makeRoomJoinLink(ctx.from.id,roomId);
     // Announcement owns applications and public card. ROOM owns meeting state,
     // MPB owns the only Telegram send. No duplicate business module.
     const ann=await createAnnouncement(ctx.from.id,revision,"recruitment",
      title+"\n"+description,startAt,[],[],roomId);
     sourceId=ann.sourceId;
     text=preview("room",draft);
     const rows:{text:string;url:string}[][]=[];
     if(visibility==="approved_only"){
      // Applicants must be able to request approval for both scheduled and
      // immediate ROOMs; a join button alone never grants private access.
      rows.push([{text:"📨 参加希望",url:await makeApplicationLink(ctx.from.id,Number(sourceId))}]);
     }
     if(!startAt){
      rows.push([{text:"🎥 参加する",url:await makeRoomJoinLink(ctx.from.id,roomId)}]);
     }
     if(draft.data.profileLinked){
      const profileUrl=await existingPublishedProfileUrl(ctx.from.id);
      if(!profileUrl)throw new Error("ROOM_PUBLIC_PROFILE_NOT_AVAILABLE");
      rows.push([{text:"🪪 プロフを見る",url:profileUrl}]);
     }
     buttons=rows;
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
     if(kind!=="recruitment"&&draft.data.profileLinked){
      const profileUrl=await existingPublishedProfileUrl(ctx.from.id);
      if(!profileUrl)throw new Error("ANNOUNCEMENT_PROFILE_NOT_AVAILABLE");
      buttons=[[{text:"🪪 プロフを見る",url:profileUrl}]];
     }
     if(kind==="recruitment"){
      const link=await makeApplicationLink(ctx.from.id,Number(sourceId));
      buttons=[[{text:"📨 応募する（Bot DM）",url:link}]];
     }
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
    else{
     await markPostSourcePublished(ctx.from.id,module==="room"?"announcement":module,sourceId);
     if(module==="room"){
      const source=await pool.query(
       "SELECT room_id FROM announcement_posts WHERE announcement_id=$1 AND owner_user_id=$2",
       [sourceId,ctx.from.id]);
      if(source.rows.length!==1||!source.rows[0].room_id)
       throw new Error("ROOM_SOURCE_NOT_LINKED");
      const roomId=Number(source.rows[0].room_id);
      const room=await pool.query(
       "SELECT status,revision FROM room_posts WHERE room_id=$1 AND owner_user_id=$2",
       [roomId,ctx.from.id]);
      if(room.rows.length!==1)throw new Error("ROOM_SOURCE_NOT_OWNED");
      if(room.rows[0].status==="draft")
       await updateRoomState(ctx.from.id,roomId,Number(room.rows[0].revision),"start");
      // Persist the template for the next ROOM rather than deleting it.
      await saveRoomEditorDraft(ctx.from.id,revision);
     }else await markDraftPublished(ctx.from.id,module,revision);
    }
   }catch{
    throw new Error("POST_SENT_SOURCE_SYNC_NEEDS_RECONCILE");
   }
   if(module==="room"){
    await ctx.editMessageText("✅ ROOMを公開しました。\n投稿先："+result.chatId+
     " / Topic "+result.threadId+"\n投稿ID："+result.messageId+
     (isScheduledRoom?"\n📅 予告中です。開催時には /myrooms から［開始する］を押してください。":"\n🔴 LIVE中"),
     hostJoinUrl&&!isScheduledRoom?Markup.inlineKeyboard([
      [Markup.button.url("🎥 ROOMに入る",hostJoinUrl)]]):undefined);
   }else await ctx.editMessageText("✅ 投稿済み\n投稿先："+result.chatId+
    " / Topic "+result.threadId+"\n投稿ID："+result.messageId);
  }catch(e){
   const msg=e instanceof Error?e.message:"投稿失敗";
   await ctx.reply(msg==="PUBLISH_NEEDS_RECONCILE"||msg==="POST_SENT_SOURCE_SYNC_NEEDS_RECONCILE"?
    "投稿と元データの照合が必要です。重複投稿防止のため自動再送は行いません。":
    "投稿を確認できませんでした："+msg);
  }
 });
}
