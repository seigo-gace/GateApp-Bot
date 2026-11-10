import { Markup, type Telegraf, type Telegram, type Context } from "telegraf";
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
 createAnnouncement,markDraftPublished,markPostSourcePublished,saveAnnouncementEditorDraft,type PostModule,type EditorDraft } from "../services/publicPostRepository.js";
import {BOARD_KEYS,BOARD_TITLES,type BoardKey,type PostPurpose} from "../services/topicRouting.js";
import { currentMenuOrigin } from "../services/menuOriginRepository.js";
import { currentTopicDmEntry,assertTopicDmEntryDestination,verifiedOriginTopic } from "../services/topicDmEntry.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import { PURPOSE_TAGS, validateAnnouncementTags, normalizePlaceCodes } from "../services/announcementTags.js";
import {parseLinkInput,renderLinkCard,buttonGrid,type LinkDraft} from "../services/linkButtonDomain.js";
import {ownerUsernameLink} from "../services/telegramUsernameLink.js";
import {makeRoomJoinLink} from "../services/roomJoinLinks.js";
import {makeApplicationLink} from "../services/applicationLinks.js";
import {updateRoomState,updateRoomDetails} from "../services/roomLifecycle.js";
import {loadRoomPublication,roomPublicationEditor,deletePublishedRoom} from "../services/roomPublishedEditor.js";
import {showWizardScreen,removeUserWizardInput,type WizardKeyboard} from "../services/dmWizardScreen.js";
import {editMessageToDmPostingMenu} from "../services/dmPostingMenuRestore.js";
import {showRecruitmentPublished,inputInstructions,recruitmentEditorFieldRows} from "./recruitmentHandlers.js";
import {styledInlineButton as styledRecruitmentButton} from "../services/inlineButtonStyle.js";
import {parseRecruitmentMessage,renderRecruitmentPreview,recruitmentIdentityLines,validateRecruitmentIdentityReady,changeRecruitmentField,type RecruitmentInput} from "../services/recruitmentCompose.js";
import {PROFILE_POSITIONS,isProfilePosition,type ProfileBasicDraft} from "../services/profileCore.js";
import {LIKE_CATEGORIES,LIKE_PAGE_SIZE,toggleLike,validLikeTags,type LikeTag} from "../services/profileLike.js";
import {roomCrossPostTargets} from "../services/roomCrossPost.js";
import {rememberPublishedRecruitmentDmScreen} from "../services/recruitmentPublishedEdit.js";

async function showPostScreen(
 telegram:Telegram,userId:number,draft:EditorDraft,text:string,keyboard?:WizardKeyboard,html=false,
):Promise<void>{
 const old=typeof draft.data.screenMessageId==="number"?draft.data.screenMessageId:undefined;
 const shown=await showWizardScreen(telegram,userId,old,text,keyboard,html?"HTML":undefined);
 if(shown.messageId!==old)
  await bindDraftScreen(userId,draft.module,draft.revision,shown.messageId);
}
async function showRoomPublished(telegram:Telegram,owner:number,sourceId:number,screenId?:number):Promise<void>{
 const published=await loadRoomPublication(owner,sourceId);
 const view=roomPublicationEditor(published);
 const draft=await getDraft(owner,"room");
 const old=screenId??Number(draft?.data.screenMessageId);
 await showWizardScreen(telegram,owner,old,view.text,view.keyboard);
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
  const stage=String(draft.data.stage||"");
  const state=stage==="scheduled_ready"||when?"📅 予告中":"🟡 開始待ち";
  return ["🎬 ROOM："+escapeProfileHtml(title),
    escapeProfileHtml(description),
    "方式："+(externalUrl?"URL持込":"無料Jitsi"),
    "開催："+(when?when.toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})+"（日本時間）":"今すぐ"),
    "参加："+(draft.data.visibility==="public"?"自由参加":"承認制"),
    "プロフ連携："+(draft.data.profileLinked?"あり":"なし"),
    "状態："+state].join("\n");
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
   (module==="room"||!pinned||
    (x.chatId===pinned.chatId&&x.threadId===pinned.threadId)));
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

function roomRecruitmentData(d:EditorDraft):RecruitmentInput{
 const o=d.data;
 return {
  title:String(o.title||""),body:String(o.description||""),
  mode:o.recruitmentMode==="linked"?"linked":"manual",
  nickname:typeof o.nickname==="string"?o.nickname:undefined,
  heightCm:Number(o.heightCm)||undefined,weightKg:Number(o.weightKg)||undefined,
  age:Number(o.age)||undefined,position:typeof o.position==="string"?o.position:undefined,
  purposeCodes:[],placeCodes:[],
 };
}
/** Preserve the existing ROOM card while reusing recruitment's identity formatting. */
function roomPublishedText(d:EditorDraft,profile?:ProfileBasicDraft|null):string{
 const original=preview("room",d),index=original.lastIndexOf("\n状態：");
 if(index<0)throw Error("ROOM_PUBLIC_STATE_INVALID");
 const identity=recruitmentIdentityLines(roomRecruitmentData(d),profile);
 const like=roomTags(d,"likeTags").map(t=>"#"+escapeProfileHtml(t.tag));
 const love=roomTags(d,"loveTags").map(t=>"#"+escapeProfileHtml(t.tag));
 return original.slice(0,index)+"\n"+identity.join("\n")+
  "\n#Like："+like.join(" ")+"\n#Love："+love.join(" ")+original.slice(index);
}
function roomTags(d:EditorDraft,key:"likeTags"|"loveTags"):LikeTag[]{
 return validLikeTags(Array.isArray(d.data[key])?d.data[key] as LikeTag[]:[]);
}
function roomOptions(d:EditorDraft){
 const r=d.revision,linked=d.data.recruitmentMode==="linked";
 const b=styledRecruitmentButton;
 const rows:any[][]=recruitmentEditorFieldRows(linked?"linked":"manual",r,{
  edit:field=>`room:field:${r}:${field}`,
  position:()=>`room:position:${r}`,
  firstTag:()=>`room:tag:${r}:like`,
  secondTag:()=>`room:tag:${r}:love`,
 },{
  position:d.data.position?"✅ ポジション":"ポジション選択",
  firstTag:"#Like",secondTag:"#Love",
 });
 rows.push([b("▶ 即開始",`room:plan:${r}:now`,"success"),
  b("📅 予告する",`room:plan:${r}:scheduled`,"primary")]);
 rows.push([b("↩ 戻る",`room:back:${r}`),
  b("キャンセル",`room:cancel:${r}`,"danger")]);
 return Markup.inlineKeyboard(rows);
}
export function roomStageKeyboard(d:EditorDraft):WizardKeyboard{
 const r=d.revision,stage=String(d.data.stage||"");
 const b=styledRecruitmentButton;
 const nav=[[b("↩ 戻る",`room:back:${r}`),
  b("キャンセル",`room:cancel:${r}`,"danger")]];
 if(!d.data.modeSelected||stage==="method")
  return Markup.inlineKeyboard([
   [b("Room作成",`room:mode:${r}:jitsi`,"success"),
    b("Room持ち込み",`room:mode:${r}:external`,"primary")],
   [b("キャンセル",`room:cancel:${r}`,"danger")]
  ]);
 if(stage==="join_choice")return Markup.inlineKeyboard([
  [b("自由参加",`room:joinmode:${r}:public`,"success"),
   b("承認制",`room:joinmode:${r}:approved_only`,"primary")],
  ...nav
 ]);
 if(stage==="scheduled_ready")return Markup.inlineKeyboard([
  [b("✅ 投稿する",`room:publish:${r}`,"success")],
  ...nav
 ]);
 if(stage==="position")return Markup.inlineKeyboard([
  ...PROFILE_POSITIONS.map((value,i)=>({text:String(value),
   callback_data:`room:positionchoice:${r}:${i}`}))
   .reduce<Array<Array<{text:string;callback_data:string}>>>((rows,item,i)=>{
    if(i%3===0)rows.push([]);rows[rows.length-1]!.push(item);return rows;
   },[]),
  ...nav
 ]);
 if(stage==="tag_categories")return Markup.inlineKeyboard([
  ...LIKE_CATEGORIES.map((c,i)=>b(c.name,`room:tagcat:${r}:${i}`,"primary"))
   .reduce<any[][]>((rows,item,i)=>{if(i%3===0)rows.push([]);rows.at(-1)!.push(item);return rows;},[]),
  ...nav
 ]);
 if(stage==="tag_items"){
  const cat=Number(d.data.tagCategory),page=Number(d.data.tagPage)||0;
  const category=LIKE_CATEGORIES[cat];
  if(!category)throw Error("ROOM_TAG_CATEGORY_INVALID");
  const selected=roomTags(d,d.data.tagPurpose==="love"?"loveTags":"likeTags");
  const items=category.items.slice(page*LIKE_PAGE_SIZE,(page+1)*LIKE_PAGE_SIZE);
  const rows=items.map((item,i)=>b(
   (selected.some(t=>t.category===category.name&&t.tag===item)?"✅ ":"▫️ ")+item,
   `room:tagitem:${r}:${cat*100+page*LIKE_PAGE_SIZE+i}`,"success"))
   .reduce<any[][]>((out,item,i)=>{if(i%3===0)out.push([]);out.at(-1)!.push(item);return out;},[]);
  const pagination:any[]=[];
  if(page>0)pagination.push(Markup.button.callback("◀ 前へ",`room:tagpage:${r}:${page-1}`));
  if((page+1)*LIKE_PAGE_SIZE<category.items.length)
   pagination.push(Markup.button.callback("次へ ▶",`room:tagpage:${r}:${page+1}`));
  if(pagination.length)rows.push(pagination);
  rows.push([b("✅ 保存",`room:tagsave:${r}`,"success"),
   b("↩ 戻る",`room:tagback:${r}`)]);
  rows.push([Markup.button.callback("キャンセル",`room:cancel:${r}`)]);
  return Markup.inlineKeyboard(rows);
 }
 if(d.step==="awaiting_room_url"||d.step==="awaiting_datetime")
  return Markup.inlineKeyboard(nav);
 // Reuse the same Recruitment controls while text is being entered, not just
 // a lone Cancel button. Incomplete input remains protected by validation.
 return roomOptions(d);
}
async function roomPreviewScreen(telegram:Telegram,userId:number,d:EditorDraft):Promise<void>{
 const stage=String(d.data.stage||"");
 if(!d.data.modeSelected||stage==="method"){
  await showPostScreen(telegram,userId,d,"🎬 募集+Room\nRoom作成方法を選択してください。",
   roomStageKeyboard(d));return;
 }
 if(stage==="join_choice"){
  await showPostScreen(telegram,userId,d,
   "📅 予告する\n参加方法を選択してください。\n自由参加 または 承認制",roomStageKeyboard(d));return;
 }
 if(stage==="scheduled_ready"){
  await showPostScreen(telegram,userId,d,
   "📅 募集+Room｜予告確認\n"+preview("room",d)+
   "\n\n内容を確認して［投稿する］を押してください。",roomStageKeyboard(d));return;
 }
 if(stage==="position"||stage==="tag_categories"||stage==="tag_items"){
  await showPostScreen(telegram,userId,d,stage==="position"?"ポジションを選んでください。":
   "🏷️ #"+(d.data.tagPurpose==="love"?"Love":"Like")+" を選択してください。",roomStageKeyboard(d));return;
 }
 if(d.step==="awaiting_room_url"){
  await showPostScreen(telegram,userId,d,
   "🔗 持ち込みROOMのHTTPS参加URLを送信してください。\n送信内容はBotが回収します。",
   roomStageKeyboard(d));return;
 }
 if(d.step==="awaiting_datetime"){
  await showPostScreen(telegram,userId,d,
   "📅 予告日時を日本時間で送信してください。\n例：2026/11/20 20:00",
   roomStageKeyboard(d));return;
 }
 if(d.step==="awaiting_text"){
  const field=String(d.data.editField||"");
  const linked=d.data.recruitmentMode==="linked";
  // Reuse the *same* full instruction and example as the adopted 相手募集.
  // ROOM customizes only the heading; no second interpretation of line order.
  const guide=field==="title"?"タイトルを1行で送信してください。":
   field==="nickname"?"ニックネームを送信してください。":
   field==="stats"?"身長 体重 年齢 を送信してください。":
   field==="body"?"募集内容を送信してください。":
   inputInstructions(linked).replace("📢 相手募集を作成","🎬 募集+Room｜入力");
  await showPostScreen(telegram,userId,d,
   guide+"\n\n送信した内容をBotが回収し、同じ画面のプレビューに反映します。",
   roomStageKeyboard(d));return;
 }
 const ready=String(d.data.title||"").trim()&&String(d.data.description||"").trim();
 if(!ready){
  const next=await updateDraft(userId,"room",d.revision,"awaiting_text",d.data);
  await roomPreviewScreen(telegram,userId,next);return;
 }
 const profile=d.data.recruitmentMode==="linked"?await getProfile(userId):null;
 const recruitment=roomRecruitmentData(d);
 const detail=renderRecruitmentPreview(recruitment,profile);
 const like=roomTags(d,"likeTags").map(t=>"#"+escapeProfileHtml(t.tag)).join(" ");
 const love=roomTags(d,"loveTags").map(t=>"#"+escapeProfileHtml(t.tag)).join(" ");
 await showPostScreen(telegram,userId,d,
  "🎬 募集+Room（未投稿）\n"+detail+
  "\n#Like："+like+"\n#Love："+love+
  "\n\nRoom方式："+(d.data.externalUrl?"持ち込み":"Room作成"),
  roomStageKeyboard(d),true);
}
/** Use the authenticated Topic-origin contract shared with 相手募集.
 * Only an unavailable/unverified ROOM destination opens the fallback picker.
 */
async function verifiedRoomTargets(userId:number){
 const pinned=await currentTopicDmEntry(userId);
 const origin=pinned??await currentMenuOrigin(userId);
 return roomCrossPostTargets(await listVerifiedTopics("room"),
  await listVerifiedTopics("announcement"),origin);
}
async function roomPublishConfirmation(telegram:Telegram,userId:number,d:EditorDraft){
 let targets;
 try{targets=await verifiedRoomTargets(userId);}catch{return false;}
 const source=targets[0]!;
 await showPostScreen(telegram,userId,d,
  "🎬 募集+Room\n"+preview("room",d)+
  "\n\n投稿先："+escapeProfileHtml(source.title)+
  (targets.length===2?"\n＋ 同じグループのビデオチャットトピック":"")+
  "\n\nこの内容を投稿します。どちらも同じROOMの投稿です。",
  Markup.inlineKeyboard([
   [Markup.button.callback("✅ この内容で投稿",`post:publish:room:${d.revision}:${source.topicId}`)],
   [Markup.button.callback("↩ 戻る",`room:confirmback:${d.revision}`),
    Markup.button.callback("キャンセル",`room:cancel:${d.revision}`)]
  ]));
 return true;
}
/** Entry shared by /room and the verified ROOM topic menu. */
export async function startRoomEditor(telegram:Telegram,userId:number,screenId?:number):Promise<void>{
 const existing=await getDraft(userId,"room");
 if(screenId&&existing){
  await bindDraftScreen(userId,"room",existing.revision,screenId);
  existing.data.screenMessageId=screenId;
 }
 if(existing?.data.roomEditSourceId&&existing.step==="awaiting_text"){
  const sourceId=Number(existing.data.roomEditSourceId);
  await showPostScreen(telegram,userId,existing,
   "✏️ 募集+Roomのタイトルと説明文を修正します。\n"+
   "1行目：タイトル\n2行目以降：説明文\n"+
   "送信するまでは公開済み投稿は変わりません。",
   Markup.inlineKeyboard([[Markup.button.callback("キャンセル",
    `room:published:editcancel:${existing.revision}:${sourceId}`)]]));
  return;
 }
 if(existing?.step==="saved"&&existing.data.title&&existing.data.description){
  const {savedTemplate:_unused,...template}=existing.data;
  const resumed=await updateDraft(userId,"room",existing.revision,"preview",
   {...template,savedTemplate:template,startAt:null});
  await roomPreviewScreen(telegram,userId,resumed);
  return;
 }
 if(existing&&["preview","awaiting_text","awaiting_datetime","awaiting_room_url"].includes(existing.step)){
  if(existing.step==="awaiting_text"&&!existing.data.modeSelected&&
     !existing.data.title&&!existing.data.description){
   const first=await updateDraft(userId,"room",existing.revision,"preview",existing.data);
   await roomPreviewScreen(telegram,userId,first);
  }else if(existing.step==="preview"){
   await roomPreviewScreen(telegram,userId,existing);
  }else if(existing.step==="awaiting_datetime"){
   await roomPreviewScreen(telegram,userId,existing);
  }else if(existing.step==="awaiting_room_url"){
   await roomPreviewScreen(telegram,userId,existing);
  }else{
   await roomPreviewScreen(telegram,userId,existing);
  }
  return;
 }
 const draft=await beginDraft(userId,"room","preview",
  {visibility:"approved_only",profileLinked:false,modeSelected:false,...(screenId?{screenMessageId:screenId}:{})});
 await roomPreviewScreen(telegram,userId,draft);
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
 bot.action(/^room:(mode|joinmode|plan|cancel|back|field|position|positionchoice|tag|tagcat|tagitem|tagpage|tagsave|tagback|publish):(\d+)(?::([a-z_0-9]+))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]),choice=ctx.match[3]||"";
  const d=await getDraft(ctx.from.id,"room");
  if(!d||!["preview","awaiting_text","awaiting_room_url","awaiting_datetime"].includes(d.step)||d.revision!==rev){
   await ctx.answerCbQuery("操作が古くなりました。投稿メニューから再度お試しください。");return;
  }
  try{
   if(op==="plan"&&(!String(d.data.title||"").trim()||
      !String(d.data.description||"").trim())){
    await ctx.answerCbQuery("先にタイトルと募集内容を入力してください。");return;
   }
   if(op==="mode"){
    if(d.data.modeSelected&&d.data.title&&d.data.description){
     await ctx.answerCbQuery("ROOMの方式は選択済みです");return;
    }
    if(choice!=="jitsi"&&choice!=="external")throw new Error("ROOM_MODE_INVALID");
    if(choice==="external"){
     const profile=await getProfile(ctx.from.id);
     const linked=!!profile&&isProfilePosition(profile.position??"");
     const next=await updateDraft(ctx.from.id,"room",rev,"awaiting_room_url",
      {...d.data,modeSelected:true,stage:"url_input",recruitmentMode:linked?"linked":"manual",
       ...(linked?{profileRevision:profile!.revision,likeTags:profile!.likeTags??[],
         loveTags:profile!.loveTags??[],position:profile!.position}:{} )});
     await ctx.answerCbQuery();
     await showPostScreen(ctx.telegram,ctx.from.id,next,
      "外部ROOMのHTTPS参加URLを1通で送信してください。",
      roomStageKeyboard(next));
     return;
    }
    const profile=await getProfile(ctx.from.id);
    const linked=!!profile&&isProfilePosition(profile.position??"");
    const next=await updateDraft(ctx.from.id,"room",rev,
     d.data.title&&d.data.description?"preview":"awaiting_text",
     {...d.data,modeSelected:true,externalUrl:null,stage:"details",
      recruitmentMode:linked?"linked":"manual",...(linked?{
       profileRevision:profile!.revision,likeTags:profile!.likeTags??[],
       loveTags:profile!.loveTags??[],position:profile!.position}:{} )});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="joinmode"){
    if(d.data.stage!=="join_choice"||!["public","approved_only"].includes(choice))
     throw Error("ROOM_VISIBILITY_INVALID");
    const next=await updateDraft(ctx.from.id,"room",rev,"awaiting_datetime",
     {...d.data,visibility:choice,stage:"date_input",startAt:null});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="plan"){
    if(d.step!=="preview")throw Error("ROOM_DETAILS_REQUIRED");
    validateRecruitmentIdentityReady(roomRecruitmentData(d),
     d.data.recruitmentMode==="linked"?await getProfile(ctx.from.id):null);
    if(choice==="scheduled"){
     const next=await updateDraft(ctx.from.id,"room",rev,"preview",
      {...d.data,startAt:null,stage:"join_choice"});
     await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
    }else if(choice==="now"){
     const next=await updateDraft(ctx.from.id,"room",rev,"preview",
      {...d.data,startAt:null,visibility:"public",stage:"immediate_ready"});
     const targets=await verifiedRoomTargets(ctx.from.id);
     await publishAccepted(ctx,"room",next.revision,targets[0]!.topicId);
    }else throw new Error("ROOM_PLAN_INVALID");
   }else if(op==="back"){
    let step:EditorDraft["step"]="preview";
    let data={...d.data};
    const stage=String(data.stage||"");
    if(stage==="join_choice")data={...data,stage:"details"};
    else if(stage==="scheduled_ready")data={...data,stage:"join_choice"};
    else if(stage==="date_input")data={...data,stage:"join_choice"};
    else if(stage==="tag_items")data={...data,stage:"tag_categories"};
    else if(["tag_categories","position"].includes(stage))
     data={...data,stage:"details",tagPurpose:null};
    else if(stage==="details"||stage==="url_input")
     data={...data,stage:"method",modeSelected:false};
    else if(stage==="immediate_ready")data={...data,stage:"details"};
    if(d.step==="awaiting_text"&&d.data.editField){
     data={...d.data,stage:"details",editField:null};
    }
    if(!data.modeSelected||d.step==="awaiting_text")step="preview";
    const next=await updateDraft(ctx.from.id,"room",rev,step,data);
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="field"){
    if(!["title","nickname","stats","body"].includes(choice))throw Error("ROOM_FIELD_INVALID");
    if(d.data.recruitmentMode==="linked"&&["nickname","stats"].includes(choice))
     throw Error("ROOM_PROFILE_LINKED_READONLY");
    const next=await updateDraft(ctx.from.id,"room",rev,"awaiting_text",
     {...d.data,editField:choice,stage:"details"});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="position"){
    if(d.data.recruitmentMode==="linked"){
     await ctx.answerCbQuery("保存済みプロフィールのポジションを利用します。");return;
    }
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",{...d.data,stage:"position"});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="positionchoice"){
    const value=PROFILE_POSITIONS[Number(choice)];
    if(!isProfilePosition(value??"")||d.data.recruitmentMode==="linked")
     throw Error("ROOM_POSITION_INVALID");
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,position:value,stage:"details"});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="tag"){
    if(!["like","love"].includes(choice))throw Error("ROOM_TAG_PURPOSE_INVALID");
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,stage:"tag_categories",tagPurpose:choice});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="tagcat"){
    const cat=Number(choice);
    if(!LIKE_CATEGORIES[cat]||d.data.stage!=="tag_categories")throw Error("ROOM_TAG_CATEGORY_INVALID");
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,stage:"tag_items",tagCategory:cat,tagPage:0});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="tagitem"){
    const packed=Number(choice),cat=Math.floor(packed/100),item=packed%100;
    if(!LIKE_CATEGORIES[cat]||cat!==Number(d.data.tagCategory)||d.data.stage!=="tag_items")
     throw Error("ROOM_TAG_INVALID");
    const purpose=d.data.tagPurpose==="love"?"loveTags":"likeTags";
    const nextTags=toggleLike(roomTags(d,purpose),cat,item);
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,[purpose]:nextTags});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="tagpage"){
    const page=Number(choice),cat=LIKE_CATEGORIES[Number(d.data.tagCategory)];
    if(d.data.stage!=="tag_items"||!cat||page<0||page>=Math.ceil(cat.items.length/LIKE_PAGE_SIZE))
     throw Error("ROOM_TAG_PAGE_INVALID");
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,tagPage:page});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="tagback"||op==="tagsave"){
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,stage:op==="tagback"?"tag_categories":"details"});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="publish"){
    if(d.step!=="preview"||d.data.stage!=="scheduled_ready"||!d.data.startAt)
     throw Error("ROOM_SCHEDULE_NOT_READY");
    const targets=await verifiedRoomTargets(ctx.from.id);
    await publishAccepted(ctx,"room",d.revision,targets[0]!.topicId);
   }else if(op==="cancel"){
    const template=d.data.savedTemplate;
    const previous=template&&typeof template==="object"&&!Array.isArray(template)?
     template as Record<string,unknown>:null;
    await updateDraft(ctx.from.id,"room",rev,previous?"saved":"cancelled",
     previous??{cancelled:true});
    await ctx.answerCbQuery();
    await editMessageToDmPostingMenu(ctx,ctx.from.id);
   }
  }catch{
   await ctx.answerCbQuery("操作できません。投稿メニューから再度お試しください。");
  }
 });
 bot.action(/^room:confirmback:(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.step!=="preview"||d.revision!==Number(ctx.match[1])){
   await ctx.answerCbQuery("古い操作です");return;
  }
  await ctx.answerCbQuery();
  await roomPreviewScreen(ctx.telegram,ctx.from.id,d);
 });
 bot.action(/^room:published:edit:(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const sourceId=Number(ctx.match[1]);
  try{
   const pub=await loadRoomPublication(ctx.from.id,sourceId);
   if(["finished","cancelled"].includes(pub.status)){
    await ctx.answerCbQuery("終了済みROOMは編集できません");return;
   }
   const old=await getDraft(ctx.from.id,"room");
   const screenId="message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined;
   const edit=await beginDraft(ctx.from.id,"room","awaiting_text",{
    roomEditSourceId:sourceId,roomEditRoomId:pub.roomId,roomEditRevision:pub.roomRevision,
    savedTemplate:old?.data??null,screenMessageId:screenId,
   });
   await ctx.answerCbQuery();
   await showPostScreen(ctx.telegram,ctx.from.id,edit,
    "✏️ 募集+Roomのタイトルと説明文を修正します。\n"+
    "1行目：タイトル\n2行目以降：説明文\n"+
    "送信するまでは公開済み投稿は変わりません。",
    Markup.inlineKeyboard([[Markup.button.callback("キャンセル",
     `room:published:editcancel:${edit.revision}:${sourceId}`)]]));
  }catch{
   await ctx.answerCbQuery("公開済みROOMを確認できません");
  }
 });
 bot.action(/^room:published:editcancel:(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]),sourceId=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.step!=="awaiting_text"||d.revision!==rev||
     Number(d.data.roomEditSourceId)!==sourceId){
   await ctx.answerCbQuery("古い編集操作です");return;
  }
  const saved=d.data.savedTemplate;
  const restore=saved&&typeof saved==="object"&&!Array.isArray(saved)?
   saved as Record<string,unknown>:{cancelled:true};
  await updateDraft(ctx.from.id,"room",rev,saved?"saved":"cancelled",restore);
  await ctx.answerCbQuery();
  await showRoomPublished(ctx.telegram,ctx.from.id,sourceId,
   Number(d.data.screenMessageId)||undefined);
 });
 bot.action(/^room:published:delete:(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const sourceId=Number(ctx.match[1]);
  try{
   const pub=await loadRoomPublication(ctx.from.id,sourceId);
   if(["finished","cancelled"].includes(pub.status)){
    await ctx.answerCbQuery("終了済みです");return;
   }
   await ctx.answerCbQuery();
   await ctx.editMessageText("🗑 この募集+Roomを削除しますか？\n"+
    "元トピックとビデオチャットトピックの両方が対象です。",
    Markup.inlineKeyboard([
     [Markup.button.callback("🗑 削除する",
       `room:published:deleteconfirm:${sourceId}:${pub.roomRevision}`)],
     [Markup.button.callback("↩ 戻る",`room:published:manage:${sourceId}`)]
    ]));
  }catch{await ctx.answerCbQuery("ROOMの投稿を確認できません");}
 });
 bot.action(/^room:published:manage:(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  await ctx.answerCbQuery();
  await showRoomPublished(ctx.telegram,ctx.from.id,Number(ctx.match[1]),
   "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
 });
 bot.action(/^room:published:deleteconfirm:(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const sourceId=Number(ctx.match[1]),revision=Number(ctx.match[2]);
  await ctx.answerCbQuery("投稿を削除しています");
  try{
   await deletePublishedRoom(ctx.telegram,ctx.from.id,sourceId,revision);
   await ctx.editMessageText("✅ 募集+Roomを削除しました。\n"+
    "元トピックとビデオチャットトピックの削除結果を記録しました。");
  }catch{
   await ctx.editMessageText("⚠️ 削除結果の確認が必要です。"+
    "\n重複削除を避けるため自動再実行はしません。");
  }
 });
 bot.action(/^room:published:(start|finish|cancel):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const action=ctx.match[1],sourceId=Number(ctx.match[2]),rev=Number(ctx.match[3]);
  try{
   const pub=await loadRoomPublication(ctx.from.id,sourceId);
   if(pub.roomRevision!==rev||!((action==="start"&&["draft","scheduled","ready","postponed"].includes(pub.status))||
     (action==="finish"&&pub.status==="live")||
     (action==="cancel"&&["draft","scheduled","ready","postponed"].includes(pub.status)))){
    await ctx.answerCbQuery("ROOMの状態が変更されています");return;
   }
   await updateRoomState(ctx.from.id,pub.roomId,rev,action as "start"|"finish"|"cancel");
   await ctx.answerCbQuery(action==="start"?"ROOMを開始しました":"終了状態を記録しました");
   await showRoomPublished(ctx.telegram,ctx.from.id,sourceId,
    "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
  }catch{
   await ctx.answerCbQuery("ROOMの状態を更新できません。/myrooms で確認してください");
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
    await ctx.answerCbQuery();
    await editMessageToDmPostingMenu(ctx,ctx.from.id);
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
   if(current.module==="room"&&current.data.roomEditSourceId){
    const sourceId=Number(current.data.roomEditSourceId);
    const roomId=Number(current.data.roomEditRoomId);
    const expectedRevision=Number(current.data.roomEditRevision);
    const {title,description}=parseRoomDetails(input);
    await updateRoomDetails(ctx.from.id,roomId,expectedRevision,title,description);
    const old=current.data.savedTemplate;
    const data=old&&typeof old==="object"&&!Array.isArray(old)?
     old as Record<string,unknown>:{cancelled:true};
    await updateDraft(ctx.from.id,"room",current.revision,
     old?"saved":"cancelled",data);
    await showRoomPublished(ctx.telegram,ctx.from.id,sourceId,
     Number(current.data.screenMessageId)||undefined);
    return;
   }
   let data:Record<string,unknown>;
   if(current.step==="awaiting_datetime"){
    const date=parseJstDateTime(input);
    if(current.module==="room"){
     const updated=await updateDraft(ctx.from.id,"room",current.revision,"preview",
      {...current.data,startAt:date.toISOString(),stage:"scheduled_ready"});
     await roomPreviewScreen(ctx.telegram,ctx.from.id,updated);
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
    const hasDetails=Boolean(String(current.data.title||"").trim()&&
      String(current.data.description||"").trim());
    const updated=await updateDraft(ctx.from.id,"room",current.revision,
     hasDetails?"preview":"awaiting_text",
     {...current.data,externalUrl,stage:"details"});
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
    const currentInput=roomRecruitmentData(current);
    const field=String(current.data.editField||"");
    if(field){
     const changed=changeRecruitmentField(currentInput,
      field as "title"|"nickname"|"stats"|"body",input);
     data={...current.data,...changed,title:changed.title,
      description:changed.body,editField:null};
    }else{
     const parsed=parseRecruitmentMessage(input,current.data.recruitmentMode==="linked");
     data={...current.data,...parsed,title:parsed.title,description:parsed.body,
      position:current.data.position??null,editField:null};
    }
    const externalUrl=data.externalUrl?String(data.externalUrl):undefined;
    validateRoom({ownerId:ctx.from.id,name:String(data.title),
     mode:externalUrl?"external":"jitsi",externalUrl,status:"draft"});
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
   await render(current,errorText,current.module==="room"?
    roomStageKeyboard(current):current.module==="link"?
    Markup.inlineKeyboard([
     ...(Array.isArray(current.data.buttons)&&current.data.buttons.length?
       [[Markup.button.callback("↩ プレビューに戻る",
        "post:link:back:"+current.revision)]]:[]),
     [Markup.button.callback("キャンセル","post:link:cancel:"+current.revision)]
    ]):undefined);
  }
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
   await ctx.answerCbQuery();
   await editMessageToDmPostingMenu(ctx,ctx.from.id);
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
   if(module==="room"){
    const draft=await getDraft(ctx.from.id,"room");
    if(!draft||draft.step!=="preview"||draft.revision!==rev)
     throw Error("ROOM_DRAFT_STALE");
    const updated=await updateDraft(ctx.from.id,"room",rev,"preview",{
     ...draft.data,topicId:selected.id,destinationExplicit:true,
     destinationLabel:BOARD_TITLES[selected.board]+" / "+selected.title});
    await ctx.answerCbQuery();
    await showPostScreen(ctx.telegram,ctx.from.id,updated,
     "🎬 募集+Room\n"+preview("room",updated)+
     "\n\n投稿先："+escapeProfileHtml(BOARD_TITLES[selected.board])+
     " / "+escapeProfileHtml(selected.title),
     Markup.inlineKeyboard([
      [Markup.button.callback("✅ この内容で投稿",
       `post:publish:room:${updated.revision}:${selected.id}`)],
      [Markup.button.callback("↩ 編集に戻る",
       `room:confirmback:${updated.revision}`)]
     ]));
    return;
   }
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
  await ctx.answerCbQuery();
  await editMessageToDmPostingMenu(ctx,ctx.from.id);
 });
 async function publishAccepted(
 ctx:Context & {from:NonNullable<Context["from"]>;
  callbackQuery:NonNullable<Context["callbackQuery"]>},
 module:Module,revision:number,topicId:number,
):Promise<void>{
  await ctx.answerCbQuery("公開処理を確認しています");
  try{
   const roomTargets=module==="room"?await verifiedRoomTargets(ctx.from.id):null;
   if(module==="room"){
    const active=await getDraft(ctx.from.id,"room");
    if(!active||active.revision!==revision||
       !["scheduled_ready","immediate_ready"].includes(String(active.data.stage||"")))
     throw Error("ROOM_PUBLICATION_STAGE_INVALID");
   }
   if(roomTargets&&roomTargets[0]?.topicId!==topicId)throw Error("ROOM_ORIGIN_CHANGED");
   const destination=await getVerifiedTopic(topicId,
    roomTargets?roomTargets[0]!.purpose:module as PostPurpose);
   const roomDraft=module==="room"?await getDraft(ctx.from.id,"room"):null;
   if(module==="room"&&roomDraft?.data.destinationExplicit===true){
    if(roomDraft.step!=="preview"||roomDraft.revision!==revision||
       roomDraft.data.topicId!==topicId)throw Error("ROOM_EXPLICIT_DESTINATION_STALE");
   }else await assertTopicDmEntryDestination(ctx.from.id,destination.chatId,destination.threadId);
   let sourceId:string;let text:string;
   let isRecruitment=false;
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
     const profile=draft.data.recruitmentMode==="linked"?await getProfile(ctx.from.id):null;
     if(draft.data.recruitmentMode==="linked"&&!profile)
      throw Error("ROOM_PROFILE_MISSING");
     text=roomPublishedText(draft,profile);
     const rows:{text:string;url:string}[][]=[
      [{text:"🔗 募集者へ連絡",url:await ownerUsernameLink(ctx.telegram,ctx.from.id)}]
     ];
     if(visibility==="approved_only"){
      rows.push([{text:"📝 応募する",url:await makeApplicationLink(ctx.from.id,Number(sourceId))}]);
     }
     rows.push([{text:"🎥 参加する",url:await makeRoomJoinLink(ctx.from.id,roomId)}]);
     if(draft.data.profileLinked){
      const profileUrl=await existingPublishedProfileUrl(ctx.from.id);
      if(!profileUrl)throw new Error("ROOM_PUBLIC_PROFILE_NOT_AVAILABLE");
      rows.push([{text:"🪪 プロフを見る",url:profileUrl}]);
     }
     buttons=rows;
    }else{
     const kind=draft.data.kind as AnnouncementKind;
     isRecruitment=kind==="recruitment";
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
      buttons=[[{text:"🔗 募集者へ連絡",url:await ownerUsernameLink(ctx.telegram,ctx.from.id)}]];
     }
    }
   }
   // One source and independently acknowledged Telegram delivery per Topic.
   let result:{messageId:number;chatId:number;threadId:number}|undefined;
   if(module==="room"&&roomTargets){
    for(const target of roomTargets){
     const sent=await publishPost(ctx.telegram,{
      sourceType:"announcement",destinationPurpose:target.purpose,
      sourceId,ownerId:ctx.from.id,revision,topicId:target.topicId,text,
      buttons,approved:true});
     if(!result)result=sent;
    }
   }else{
    result=await publishPost(ctx.telegram,{
     sourceType:module,sourceId,ownerId:ctx.from.id,revision,topicId,text,
     buttons,approved:true});
   }
   if(!result)throw Error("POST_DELIVERY_MISSING");
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
      // Never auto-start ROOM at publication. Owner's Start is explicit.
      // Close this temporary editor: the published ROOM has its own durable
      // source and delivery receipts; a new ROOM must get a fresh request key.
      await markDraftPublished(ctx.from.id,"room",revision);
     }else await markDraftPublished(ctx.from.id,module,revision);
    }
   }catch{
    throw new Error("POST_SENT_SOURCE_SYNC_NEEDS_RECONCILE");
   }
   if(module==="announcement"&&isRecruitment){
    // Legacy recruitment uses the same owner-scoped editor as the compact path.
    // Keep the existing Telegram message and save its private management receipt.
    const dmId="message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined;
    if(Number.isSafeInteger(dmId)&&Number(dmId)>0)
     await rememberPublishedRecruitmentDmScreen(ctx.from.id,Number(sourceId),Number(dmId));
    await showRecruitmentPublished(ctx,{...result,sourceId:Number(sourceId)});
   }else if(module==="room"){
    const screenId="message" in ctx.callbackQuery?
     ctx.callbackQuery.message?.message_id:undefined;
    await showRoomPublished(ctx.telegram,ctx.from.id,Number(sourceId),screenId);
   }else await ctx.editMessageText("✅ 投稿済み\n投稿先："+result.chatId+
    " / Topic "+result.threadId+"\n投稿ID："+result.messageId);
  }catch(e){
   const msg=e instanceof Error?e.message:"投稿失敗";
   await ctx.reply(msg==="PUBLISH_NEEDS_RECONCILE"||msg==="POST_SENT_SOURCE_SYNC_NEEDS_RECONCILE"?
    "投稿と元データの照合が必要です。重複投稿防止のため自動再送は行いません。":
    "投稿を確認できませんでした："+msg);
  }
 }
 bot.action(/^post:publish:(profile|room|announcement|link):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  await publishAccepted(ctx,ctx.match[1] as Module,Number(ctx.match[2]),Number(ctx.match[3]));
 });
}
