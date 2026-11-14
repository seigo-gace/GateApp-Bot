import { Markup, type Telegraf, type Telegram, type Context } from "telegraf";
import {pool} from "../db/index.js";
import { getProfile, recordProfilePublication } from "../services/profileRepository.js";
import { renderPublicProfile, escapeProfileHtml } from "../services/profileCore.js";
import {makeProfileViewerButtons,existingPublishedProfileUrl} from "../services/profilePublicView.js";
import {revisePublishedProfile} from "../services/profilePublicationUpdate.js";
import { listVerifiedTopics, getVerifiedTopic } from "../services/postingDelivery.js";
import { publishPost,assertFeatureReleased } from "../services/publishService.js";
import { buildRoomCard, buildAnnouncementCard, validateAnnouncement,
  validateRoom,assertHttpsMeetingUrl,parseJstDateTime,parseRoomDetails,type AnnouncementKind } from "../services/postingDomain.js";
import { beginDraft,getDraft,getWaitingDraft,updateDraft,bindDraftScreen,createRoom,createLinkButton,markRoomDraftSaved,
 createAnnouncement,markDraftPublished,markPostSourcePublished,saveAnnouncementEditorDraft,type PostModule,type EditorDraft } from "../services/publicPostRepository.js";
import {BOARD_KEYS,BOARD_TITLES,type BoardKey,type PostPurpose} from "../services/topicRouting.js";
import { currentMenuOrigin } from "../services/menuOriginRepository.js";
import { currentTopicDmEntry,assertTopicDmEntryDestination,verifiedOriginTopic } from "../services/topicDmEntry.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import { PURPOSE_TAGS, validateAnnouncementTags, normalizePlaceCodes } from "../services/announcementTags.js";
import {parseLinkButtonPair,renderLinkCard,buttonGrid,type LinkDraft} from "../services/linkButtonDomain.js";
import {ownerUsernameLink} from "../services/telegramUsernameLink.js";
import {makeRoomJoinLink} from "../services/roomJoinLinks.js";
import {roomPublicButtons} from "../services/roomPublicButtons.js";
import {makeApplicationLink} from "../services/applicationLinks.js";
import {updateRoomState,updateRoomDetails} from "../services/roomLifecycle.js";
import {reconcileRoomPublicCard} from "../services/roomPublicSync.js";
import {loadRoomPublication,roomPublicationEditor,deletePublishedRoom,recoverFullySentRoom,mayResumeRoomPublication,ensureImmediatePublishedRoomLive} from "../services/roomPublishedEditor.js";
import {showWizardScreen,removeUserWizardInput,type WizardKeyboard} from "../services/dmWizardScreen.js";
import {editMessageToDmPostingMenu} from "../services/dmPostingMenuRestore.js";
import {showRecruitmentPublished,inputInstructions,showRecruitmentDestinationStep} from "./recruitmentHandlers.js";
import {styledInlineButton as styledRecruitmentButton} from "../services/inlineButtonStyle.js";
import {roomRecruitmentSelectorRow} from "../services/recruitmentButtonLayout.js";
import {renderRoomApplicantSummary} from "../services/announcementApplications.js";
import {jstCurrentMonth,validPickerMonth,validPickerDay,pickerDateRows,pickerHourRows,pickerMinuteRows,pickerDateLabel,selectedPickerTime} from "../services/dateTimeInlinePicker.js";
import {roomRecruitmentCategoryRows,roomRecruitmentTagRows,roomRecruitmentTagHeading} from "../services/roomRecruitmentTagPanels.js";
import {parseRecruitmentMessage,renderRecruitmentPreview,recruitmentIdentityLines,validateRecruitmentIdentityReady,type RecruitmentInput} from "../services/recruitmentCompose.js";
import {PROFILE_POSITIONS,isProfilePosition,type ProfileBasicDraft} from "../services/profileCore.js";
import {LIKE_CATEGORIES,LIKE_PAGE_SIZE,toggleLike,validLikeTags,type LikeTag} from "../services/profileLike.js";
import {roomCrossPostTargets} from "../services/roomCrossPost.js";
import {adaptiveChoiceRows,positionChoiceRows} from "../services/inlineSelection.js";
import {rememberPublishedRecruitmentDmScreen} from "../services/recruitmentPublishedEdit.js";

async function showPostScreen(
 telegram:Telegram,userId:number,draft:EditorDraft,text:string,keyboard?:WizardKeyboard,html=false,
):Promise<void>{
 const old=typeof draft.data.screenMessageId==="number"?draft.data.screenMessageId:undefined;
 const shown=await showWizardScreen(telegram,userId,old,text,keyboard,html?"HTML":undefined);
 if(shown.messageId!==old)
  await bindDraftScreen(userId,draft.module,draft.revision,shown.messageId);
}
export const roomApplicantsCallbackPattern=/^room:published:applicants:(\d+)(?::(\d+))?$/;
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
   "\nボタン配置："+buttonGrid(d).map(row=>row.map(b=>escapeProfileHtml(b.label)).join(" ／ ")).join(" | ");
 }
 if(module==="room"){
  const title=String(draft.data.title||"");
  const description=String(draft.data.description||"");
  const externalUrl=draft.data.externalUrl?String(draft.data.externalUrl):undefined;
  validateRoom({ownerId:1,name:title,mode:externalUrl?"external":"jitsi",
   externalUrl,status:"draft"});
  const when=draft.data.startAt?new Date(String(draft.data.startAt)):null;
  const stage=String(draft.data.stage||"");
  const state=stage==="immediate_ready"?"🔴 LIVE中":stage==="scheduled_ready"||when?"📅 予告中":"🟡 開始待ち";
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
/** Four-line Recruitment input is collected as ONE message.
 * Only selectable ROOM controls belong on this keyboard.
 */
/** Four-line Recruitment message owns title/nickname/stats/body input.
 * No redundant input buttons. Row two is exactly four existing actions.
 */
function roomOptions(d:EditorDraft){
 const r=d.revision,b=styledRecruitmentButton;
 const selectors=roomRecruitmentSelectorRow(
  d.data.recruitmentMode==="linked"?"linked":"manual",
  !!d.data.position,
  {position:`room:position:${r}`,like:`room:tag:${r}:like`,love:`room:tag:${r}:love`},
  {like:roomTags(d,"likeTags").length>0,love:roomTags(d,"loveTags").length>0});
 return Markup.inlineKeyboard([
  selectors,
  [b("▶ 即開始",`room:plan:${r}:now`,"success"),
   b("📅 予告する",`room:plan:${r}:scheduled`,"primary")],
  [b("↩ 戻る",`room:back:${r}`),
   b("🪪 プロフ登録","pc:from:room","primary"),
   b("キャンセル",`room:cancel:${r}`,"danger")],
 ]);
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
 if(["date_calendar","time_hour","time_minute"].includes(stage)){
  const actions={
   month:(month:string)=>`room:dt:month:${r}:${month}`,
   day:(day:string)=>`room:dt:day:${r}:${day}`,
   hour:(hour:string)=>`room:dt:hour:${r}:${hour}`,
   minute:(minute:string)=>`room:dt:minute:${r}:${minute}`,
   manual:`room:dt:manual:${r}`,
   back:`room:back:${r}`,
   cancel:`room:cancel:${r}`,
  };
  if(stage==="date_calendar"){
   const requested=String(d.data.pickerMonth||"");
   return Markup.inlineKeyboard(pickerDateRows(
    validPickerMonth(requested)?requested:jstCurrentMonth(),actions));
  }
  return Markup.inlineKeyboard(stage==="time_hour"?
   pickerHourRows(actions):pickerMinuteRows(actions));
 }
 if(stage==="scheduled_ready")return Markup.inlineKeyboard([
  [b("✅ 投稿する",`room:publish:${r}`,"success")],
  ...nav
 ]);
 if(stage==="position")return Markup.inlineKeyboard([
  ...positionChoiceRows(PROFILE_POSITIONS,undefined,
   (_value,index)=>`room:positionchoice:${r}:${index}`)
   .map(row=>row.map(button=>styledRecruitmentButton(
    button.text,button.callback_data,"primary"))),
  ...nav
 ]);
 const tagCallbacks={
  openCategory:(index:number)=>`room:tagcat:${r}:${index}`,
  selectItem:(category:number,index:number)=>`room:tagitem:${r}:${category*100+index}`,
  changePage:(_category:number,page:number)=>`room:tagpage:${r}:${page}`,
  save:`room:tagsave:${r}`,back:`room:tagback:${r}`,
  cancel:`room:cancel:${r}`,
 };
 if(stage==="tag_categories")return Markup.inlineKeyboard(
  roomRecruitmentCategoryRows({...tagCallbacks,back:`room:back:${r}`},d.data.tagPurpose==="love"?"love":"like"));
 if(stage==="tag_items"){
  const category=Number(d.data.tagCategory),page=Number(d.data.tagPage)||0;
  const selected=roomTags(d,d.data.tagPurpose==="love"?"loveTags":"likeTags");
  return Markup.inlineKeyboard(roomRecruitmentTagRows(category,page,selected,tagCallbacks,d.data.tagPurpose==="love"?"love":"like"));
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
 if(["date_calendar","time_hour","time_minute"].includes(stage)){
  const requested=String(d.data.pickerMonth||"");
  const month=validPickerMonth(requested)?requested:jstCurrentMonth();
  const day=String(d.data.pickerDay||"");
  const hour=Number(d.data.pickerHour);
  const text=stage==="date_calendar"?
   "📅 予告する｜日付を選択\n"+month.slice(0,4)+"年"+Number(month.slice(4))+"月"+
    "\n日付を選ぶか、⌨️から日時を直接入力してください。":
   stage==="time_hour"?
    "🕒 予告する｜時を選択\n"+pickerDateLabel(day)+"（日本時間）":
    "🕒 予告する｜分を選択\n"+pickerDateLabel(day)+" "+
      String(hour).padStart(2,"0")+"時（日本時間）";
  await showPostScreen(telegram,userId,d,text,roomStageKeyboard(d));return;
 }
 if(stage==="scheduled_ready"){
  // The scheduled path must use the same complete Recruitment preview as
  // immediate ROOM, not the obsolete short ROOM-only confirmation card.
  const profile=d.data.recruitmentMode==="linked"?await getProfile(userId):null;
  const detail=renderRecruitmentPreview(roomRecruitmentData(d),profile);
  const like=roomTags(d,"likeTags").map(t=>"#"+escapeProfileHtml(t.tag)).join(" ");
  const love=roomTags(d,"loveTags").map(t=>"#"+escapeProfileHtml(t.tag)).join(" ");
  const when=d.data.startAt?new Date(String(d.data.startAt)):null;
  if(!when||!Number.isFinite(when.getTime()))throw Error("ROOM_SCHEDULE_NOT_READY");
  await showPostScreen(telegram,userId,d,
   "🎬 募集+Room（未投稿）\n"+detail+
   "\n#Like："+like+"\n#Love："+love+
   "\n\nRoom方式："+(d.data.externalUrl?"持ち込み":"Room作成")+
   "\n開催："+when.toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})+"（日本時間）",
   roomStageKeyboard(d),true);return;
 }
 if(stage==="position"||stage==="tag_categories"||stage==="tag_items"){
  const purpose=d.data.tagPurpose==="love"?"love":"like";
  const category=stage==="tag_items"?Number(d.data.tagCategory):undefined;
  await showPostScreen(telegram,userId,d,stage==="position"?"ポジションを選んでください。":
   roomRecruitmentTagHeading(purpose,category),roomStageKeyboard(d));return;
 }
 if(d.step==="awaiting_room_url"){
  await showPostScreen(telegram,userId,d,
   "🔗 持ち込みROOMのHTTPS参加URLを送信してください。\n送信内容はBotが回収します。",
   roomStageKeyboard(d));return;
 }
 if(d.step==="awaiting_datetime"){
  const day=String(d.data.pickerDay||"");
  await showPostScreen(telegram,userId,d,
   validPickerDay(day)?"🕒 "+pickerDateLabel(day)+"（日本時間）\n時刻を HH:mm で送信してください。例：20:00\n日付込みの YYYY/MM/DD HH:mm も入力できます。":
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
 // The fourth free-text line is optional; a valid title can preview without it.
 const ready=String(d.data.title||"").trim();
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
/** A historical ROOM draft can carry the explicit-choice flag without the
 * selected Topic ID. Treat only a complete, verified ID as an explicit
 * destination; the incomplete flag must not bypass origin authorization.
 */
export function hasExplicitRoomTopicChoice(data:Record<string,unknown>|null|undefined):boolean{
 return data?.destinationExplicit===true&&
  typeof data.selectedTopicId==="number"&&
  Number.isSafeInteger(data.selectedTopicId)&&data.selectedTopicId>0;
}
/** Use the authenticated Topic-origin contract shared with 相手募集.
 * Only an unavailable/unverified ROOM destination opens the fallback picker.
 */
async function verifiedRoomTargets(userId:number){
 const [recruitment,registeredRoomTopics]=await Promise.all([
  listVerifiedTopics("announcement"),listVerifiedTopics("room")
 ]);
 // Prefer the shared announcement registration where both purposes refer to
 // one Telegram Topic; do not treat that as two different source Topics.
 const roomTopics=registeredRoomTopics.filter(room=>!recruitment.some(ann=>
  ann.chatId===room.chatId&&ann.threadId===room.threadId));
 const draft=await getDraft(userId,"room");
 // Same verified posting destinations as 相手募集. Explicit choice is saved
 // on the existing ROOM draft; no separate ROOM destination registry.
 let origin:{chatId:number;threadId:number}|null=null;
 if(draft&&hasExplicitRoomTopicChoice(draft.data)){
  const chosen=recruitment.find(t=>t.id===Number(draft.data.selectedTopicId));
  if(!chosen)throw Error("ROOM_ORIGIN_NOT_VERIFIED");
  origin={chatId:chosen.chatId,threadId:chosen.threadId};
 }else{
  const pinned=await currentTopicDmEntry(userId);
  origin=pinned??await currentMenuOrigin(userId);
 }
 return roomCrossPostTargets(roomTopics,recruitment,origin);
}
/** Check the existing verified destinations and Bot access before consuming
 * a callback revision. This creates no ROOM, delivery, or DB route. */
async function verifyRoomPublicationPreflight(
 telegram:Telegram,userId:number,targets:ReturnType<typeof roomCrossPostTargets>,
 profileLinked:boolean,
):Promise<void>{
 const origin=targets[0];
 if(!origin)throw Error("ROOM_ORIGIN_NOT_VERIFIED");
 const draft=await getDraft(userId,"room");
 if(!hasExplicitRoomTopicChoice(draft?.data))
  await assertTopicDmEntryDestination(userId,origin.chatId,origin.threadId);
 const me=await telegram.getMe();
 for(const target of targets){
  await assertFeatureReleased(target.purpose);
  const verified=await getVerifiedTopic(target.topicId,target.purpose);
  const chat=await telegram.getChat(verified.chatId);
  if(chat.id!==verified.chatId||chat.type!=="supergroup")
   throw Error("ROOM_PUBLISH_CHAT_UNVERIFIED");
  const member=await telegram.getChatMember(verified.chatId,me.id);
  if(member.status!=="administrator"&&member.status!=="creator")
   throw Error("ROOM_PUBLISH_BOT_NOT_ADMIN");
 }
 await ownerUsernameLink(telegram,userId);
 if(profileLinked&&!(await existingPublishedProfileUrl(userId)))
  throw Error("ROOM_PUBLIC_PROFILE_NOT_AVAILABLE");
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
 // Preserve existing saved values but re-enter the adopted method picker.
 if(existing?.step==="saved"){
  const resumed=await updateDraft(userId,"room",existing.revision,"preview",
   {...existing.data,modeSelected:false,stage:"method",startAt:null});
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
  [Markup.button.callback("📝 編集","post:link:panel:"+rev),
   Markup.button.callback("キャンセル","post:link:cancel:"+rev)],
  [Markup.button.callback("📍 投稿先を選択","post:link:destination:"+rev)],
 ]);
}
/** Compact editing summary: no media or full posting preview. */
export function linkEditorSummary(d:EditorDraft):string{
 const data=d.data as LinkDraft;
 if(!Array.isArray(data.buttons)||!data.buttons.length)return "🔗 ボタン編集\nまだボタンはありません。";
 const layout=buttonGrid(data);
 const positions=new Map(data.buttons.map((b,i)=>[b,String(i+1)]));
 const details=data.buttons.map((b,i)=>
  String(i+1)+"　"+escapeProfileHtml(b.label)+"\n"+escapeProfileHtml(b.url)).join("\n\n");
 return "🔗 ボタン編集\n\n"+details+
  "\n\n【配置】\n"+layout.map(row=>
   row.map(b=>"［"+positions.get(b)+"］").join("")).join("\n");
}
/** Keep editing controls separate from the posting preview. */
export function linkEditKeyboard(d:EditorDraft):WizardKeyboard{
 const rev=d.revision;
 const count=Array.isArray(d.data.buttons)?d.data.buttons.length:0;
 return Markup.inlineKeyboard([
  ...(count?[[Markup.button.callback("➕ ボタンを追加","post:link:add:"+rev),
   Markup.button.callback("➡️ 横にボタンを作る","post:link:beside:"+rev)]]:[]),
  ...(count?[[Markup.button.callback("📝 最後を編集","post:link:edit:"+rev)]]:[]),
  [Markup.button.callback("👁 プレビュー","post:link:back:"+rev),
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
  const editing=prior.data.linkEditorView===true;
  await showPostScreen(telegram,userId,prior,
   editing?linkEditorSummary(prior):"公開前プレビュー\n"+preview("link",prior),
   editing?linkEditKeyboard(prior):linkPreviewKeyboard(prior));
  return;
 }
 const draft=prior?.step==="awaiting_text"?prior:
  await beginDraft(userId,"link","awaiting_text",screenId?{screenMessageId:screenId}:{});
 await showPostScreen(telegram,userId,draft,
  "🔗 ボタン名とURLを2行にして、DMで1回送信してください。\n1行目：ボタン名\n2行目：https://URL\n例：\n🔗 グループへ参加\nhttps://example.org/join",
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
 bot.action(/^room:(mode|joinmode|plan|cancel|back|position|positionchoice|tag|tagcat|tagitem|tagpage|tagsave|tagback|publish):(\d+)(?::([a-z_0-9]+))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]),choice=ctx.match[3]||"";
  const d=await getDraft(ctx.from.id,"room");
  if(!d||!["preview","awaiting_text","awaiting_room_url","awaiting_datetime"].includes(d.step)||d.revision!==rev){
   await ctx.answerCbQuery("操作が古くなりました。投稿メニューから再度お試しください。");return;
  }
  try{
   if(op==="plan"&&(d.step!=="preview"||
      !String(d.data.title||"").trim())){
    await ctx.answerCbQuery("相手募集と同じ4行入力を先に送信してください。");
    const next=d.step==="awaiting_text"?d:
     await updateDraft(ctx.from.id,"room",rev,"awaiting_text",
      {...d.data,stage:"details",editField:null});
    await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
    return;
   }
   if(op==="mode"){
    if(d.data.modeSelected&&String(d.data.title||"").trim()){
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
     String(d.data.title||"").trim()?"preview":"awaiting_text",
     {...d.data,modeSelected:true,externalUrl:null,stage:"details",
      recruitmentMode:linked?"linked":"manual",...(linked?{
       profileRevision:profile!.revision,likeTags:profile!.likeTags??[],
       loveTags:profile!.loveTags??[],position:profile!.position}:{} )});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="joinmode"){
    if(d.data.stage!=="join_choice"||!["public","approved_only"].includes(choice))
     throw Error("ROOM_VISIBILITY_INVALID");
    const next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,visibility:choice,stage:"date_calendar",startAt:null,
      pickerMonth:jstCurrentMonth(),pickerDay:null,pickerHour:null});
    await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="plan"){
    if(d.step!=="preview")throw Error("ROOM_DETAILS_REQUIRED");
    validateRecruitmentIdentityReady(roomRecruitmentData(d),
     d.data.recruitmentMode==="linked"?await getProfile(ctx.from.id):null);
    if(choice==="scheduled"){
     // A scheduled editor must not consume a revision when no verified
     // destination or Telegram posting rights exist.
     const targets=await verifiedRoomTargets(ctx.from.id);
     await verifyRoomPublicationPreflight(ctx.telegram,ctx.from.id,targets,
      d.data.profileLinked===true);
     const next=await updateDraft(ctx.from.id,"room",rev,"preview",
      {...d.data,startAt:null,stage:"join_choice"});
     await ctx.answerCbQuery();await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
    }else if(choice==="now"){
     // Resolve the destination before advancing the callback revision.
     // A missing/stale verified Topic must leave this button usable.
     const targets=await verifiedRoomTargets(ctx.from.id);
     await verifyRoomPublicationPreflight(ctx.telegram,ctx.from.id,targets,
      d.data.profileLinked===true);
     const next=await updateDraft(ctx.from.id,"room",rev,"preview",
      {...d.data,startAt:null,visibility:"public",stage:"immediate_ready"});
     await publishAccepted(ctx,"room",next.revision,targets[0]!.topicId);
    }else throw new Error("ROOM_PLAN_INVALID");
   }else if(op==="back"){
    let step:EditorDraft["step"]="preview";
    let data={...d.data};
    const stage=String(data.stage||"");
    if(stage==="join_choice")data={...data,stage:"details"};
    else if(stage==="scheduled_ready")data={...data,stage:"date_calendar"};
    else if(stage==="time_minute")data={...data,stage:"time_hour"};
    else if(stage==="time_hour")data={...data,stage:"date_calendar"};
    else if(stage==="date_calendar")data={...data,stage:"join_choice"};
    else if(stage==="date_input")data={...data,
     stage:validPickerDay(String(data.pickerDay||""))?"time_hour":"date_calendar"};
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
  }catch(error){
   // Immediate publication can advance the persisted draft revision before
   // its API work fails. Restore the latest screen so callbacks stay usable.
   if(op==="plan"&&choice==="now"){
    const fresh=await getDraft(ctx.from.id,"room").catch(()=>null);
    if(fresh&&fresh.revision!==rev&&fresh.step==="preview"){
     await ctx.answerCbQuery("ROOM生成に失敗しました。入力内容は保持しています。").catch(()=>undefined);
     await roomPreviewScreen(ctx.telegram,ctx.from.id,fresh);
     return;
    }
   }
   // Do not silently collapse a missing verified destination into a stale-DM error.
   // The draft remains intact, so retrying /start must not be required.
   const reason=error instanceof Error?error.message:"ROOM_ACTION_UNKNOWN";
   console.error("[ROOM_ACTION_FAILED]",{operation:op,reason});
   const routingFailure=[
    "ROOM_ONLINE_DESTINATION_NOT_VERIFIED",
    "ROOM_ORIGIN_AMBIGUOUS_OR_NOT_VERIFIED",
    "ROOM_ORIGIN_NOT_VERIFIED",
    "TOPIC_NOT_VERIFIED",
   ].includes(reason);
   if(routingFailure){
    await ctx.answerCbQuery().catch(()=>undefined);
    const current=await getDraft(ctx.from.id,"room");
    if(current)await showRecruitmentDestinationStep(
     ctx.telegram,ctx.from.id,current,"groups",undefined,0,0,"room");
    return;
   }
   await ctx.answerCbQuery(
    "ROOM操作に失敗しました。入力内容は保持されています。画面を再表示してお試しください。"
   ).catch(()=>undefined);
  }
 });
 bot.action(/^room:dt:(month|day|hour|minute|manual):(\d+)(?::(\d{2,8}))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]),value=ctx.match[3]||"";
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.revision!==rev||d.step!=="preview"){
   await ctx.answerCbQuery("日時選択が更新されています。最新の画面から選んでください。");return;
  }
  const stage=String(d.data.stage||"");
  if(!["date_calendar","time_hour","time_minute"].includes(stage)){
   await ctx.answerCbQuery("日時選択画面を開き直してください。");return;
  }
  try{
   let next:EditorDraft;
   if(op==="month"){
    if(stage!=="date_calendar"||!validPickerMonth(value))throw Error("日時の月を確認してください。");
    next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,pickerMonth:value});
   }else if(op==="day"){
    if(stage!=="date_calendar"||!validPickerDay(value)||
       value.slice(0,6)!==String(d.data.pickerMonth))
     throw Error("日付を選び直してください。");
    next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,pickerDay:value,pickerHour:null,stage:"time_hour"});
   }else if(op==="hour"){
    if(stage!=="time_hour"||!/^(0\d|1\d|2[0-3])$/.test(value)||
       !validPickerDay(String(d.data.pickerDay||"")))
     throw Error("時刻を選び直してください。");
    next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,pickerHour:Number(value),stage:"time_minute"});
   }else if(op==="minute"){
    if(stage!=="time_minute"||!/^[0-5]\d$/.test(value)||Number(value)%5!==0)
     throw Error("分を選び直してください。");
    const when=selectedPickerTime(String(d.data.pickerDay||""),
     Number(d.data.pickerHour),Number(value));
    next=await updateDraft(ctx.from.id,"room",rev,"preview",
     {...d.data,startAt:when.toISOString(),stage:"scheduled_ready"});
   }else if(op==="manual"){
    next=await updateDraft(ctx.from.id,"room",rev,"awaiting_datetime",
     {...d.data,stage:"date_input"});
   }else throw Error("ROOM_DATETIME_ACTION_INVALID");
   await ctx.answerCbQuery();
   await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
  }catch(err){
   const reason=err instanceof Error?err.message:"日時を選び直してください。";
   await ctx.answerCbQuery(reason.startsWith("過去")||reason.includes("過去")?
    reason:"日時を確認してください。最新の画面から再選択できます。").catch(()=>undefined);
  }
 });
 bot.action(/^room:destback:(\d+):(groups|blocks)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.revision!==Number(ctx.match[1])){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,
   ctx.match[2] as "groups"|"blocks",ctx.match[2]==="blocks"?"area_bbs":undefined,0,0,"room");
 });
 bot.action(/^room:destgroup:(\d+):(area_bbs|gay_board|video_chat)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.revision!==Number(ctx.match[1])){await ctx.answerCbQuery("古い操作です");return;}
  const board=ctx.match[2] as BoardKey;
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,
   board==="area_bbs"?"blocks":"topics",board,0,0,"room");
 });
 bot.action(/^room:destblock:(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.revision!==Number(ctx.match[1])){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,
   "topics","area_bbs",Number(ctx.match[2]),0,"room");
 });
 bot.action(/^room:destpage:(\d+):(area_bbs|gay_board|video_chat):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.revision!==Number(ctx.match[1])){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,"topics",
   ctx.match[2] as BoardKey,Number(ctx.match[3]),Number(ctx.match[4]),"room");
 });
 bot.action(/^room:destchoose:(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.revision!==Number(ctx.match[1])){await ctx.answerCbQuery("古い操作です");return;}
  const selected=await getVerifiedTopic(Number(ctx.match[2]),"announcement");
  const next=await updateDraft(ctx.from.id,"room",d.revision,d.step,{
   ...d.data,selectedTopicId:selected.id,destinationExplicit:true,
   entryChatId:selected.chatId,entryThreadId:selected.threadId,
   destinationLabel:BOARD_TITLES[selected.board]+" / "+selected.title});
  await ctx.answerCbQuery("投稿先を設定しました");
  await roomPreviewScreen(ctx.telegram,ctx.from.id,next);
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
 bot.action(/^room:reconcile:(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const revision=Number(ctx.match[1]);
  const d=await getDraft(ctx.from.id,"room");
  if(!d||d.revision!==revision||d.step!=="preview"){
   await ctx.answerCbQuery("操作情報が変更されています");return;
  }
  try{
   const targets=await verifiedRoomTargets(ctx.from.id);
   const sourceId=await recoverFullySentRoom(ctx.from.id,revision,
    targets.map(t=>t.topicId));
   if(!sourceId&&await mayResumeRoomPublication(ctx.from.id,revision,
    targets.map(t=>t.topicId))){
    // Never repeat an acknowledged or uncertain send. Only missing
    // destinations are resumed under the same original request key.
    await publishAccepted(ctx,"room",revision,targets[0]!.topicId);
    return;
   }
   await ctx.answerCbQuery();
   if(sourceId){
    if(d.data.stage==="immediate_ready")
     await ensureImmediatePublishedRoomLive(ctx.from.id,sourceId);
    await markDraftPublished(ctx.from.id,"room",revision).catch(err=>
     console.error("[ROOM_DRAFT_CLEANUP_FAILED]",
      err instanceof Error?err.message:"unknown"));
    await showRoomPublished(ctx.telegram,ctx.from.id,sourceId,
     "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
   }else await showPostScreen(ctx.telegram,ctx.from.id,d,
    "⚠️ 投稿結果に未確認の送信記録があります。確認済みの投稿は再送しません。",
    Markup.inlineKeyboard([[
     Markup.button.callback("🔄 投稿状態を確認","room:reconcile:"+revision)
    ]]));
  }catch(err){
   const reason=err instanceof Error?err.message:"unknown";
   console.error("[ROOM_RECONCILE_FAILED]",reason);
   if(["ROOM_ORIGIN_NOT_VERIFIED","ROOM_ORIGIN_AMBIGUOUS_OR_NOT_VERIFIED",
       "ROOM_ONLINE_DESTINATION_NOT_VERIFIED","TOPIC_NOT_VERIFIED"].includes(reason)){
    // Keep the original draft and request revision. Reuse the already adopted
    // recruitment destination picker; never guess a public Topic or create a
    // second ROOM just because a legacy destination selection is incomplete.
    await ctx.answerCbQuery().catch(()=>undefined);
    const current=await getDraft(ctx.from.id,"room");
    if(current?.revision===revision)
     await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,current,
      "groups",undefined,0,0,"room");
    return;
   }
   await ctx.answerCbQuery("投稿記録を確認できませんでした").catch(()=>undefined);
  }
 });
 bot.action(roomApplicantsCallbackPattern,async ctx=>{
  if(!privateDM(ctx))return;
  const announcementId=Number(ctx.match[1]),page=Number(ctx.match[2]??"0");
  if(!Number.isSafeInteger(page)||page<0||page>100){
   await ctx.answerCbQuery("応募一覧のページが不正です");return;
  }
  try{
   // Applicant management depends on the owned Room record, not the
   // Telegram delivery-receipt join needed by the public posting editor.
   const source=await pool.query(
    `SELECT r.title,r.join_visibility FROM announcement_posts a
      JOIN room_posts r ON r.room_id=a.room_id AND r.owner_user_id=a.owner_user_id
      WHERE a.announcement_id=$1 AND a.owner_user_id=$2
        AND a.kind='recruitment' AND a.room_id IS NOT NULL`,
    [announcementId,ctx.from.id]);
   if(source.rows.length!==1){
    await ctx.answerCbQuery("応募の募集元を確認できません");return;
   }
   if(source.rows[0].join_visibility!=="approved_only"){
    await ctx.answerCbQuery("このROOMは自由参加です");return;
   }
   const count=await pool.query(
    `SELECT count(*)::int AS total
      FROM announcement_applications
      WHERE announcement_id=$1`,[announcementId]);
   const total=Number(count.rows[0]?.total??0);
   const applications=await pool.query(
    `SELECT application_id,status,consented_profile FROM announcement_applications
     WHERE announcement_id=$1 ORDER BY updated_at DESC,application_id DESC
     LIMIT 3 OFFSET $2`,[announcementId,page*3]);
   const blocks:string[]=[];
   const buttons:Array<Array<ReturnType<typeof Markup.button.callback>>>=[];
   for(const row of applications.rows){
    const id=Number(row.application_id),status=String(row.status);
    const snapshot=row.consented_profile as Record<string,unknown>|null;
    // Shorten display only; the existing detail view retains the full snapshot.
    let card="応募内容を取得できませんでした";
    if(snapshot){
     try{
      const body=String(snapshot.body||"");
      card=renderRoomApplicantSummary({...snapshot,
       body:body.slice(0,160)+(body.length>160?"…":""),
       likeTags:validLikeTags(snapshot.likeTags as []??[]).slice(0,6),
       loveTags:validLikeTags(snapshot.loveTags as []??[]).slice(0,6)});
     }catch{card="応募内容の形式を確認してください。応募詳細を開けます。";}
    }
    blocks.push("【応募者 "+(page*3+blocks.length+1)+"】\n"+card+"\n状態："+status);
    const controls=[Markup.button.callback("👤 応募詳細",
     `application:manage:view:${id}`)];
    if(["submitted","held"].includes(status))controls.push(
     Markup.button.callback("✅ 承認",`application:decide:${id}:accepted`),
     Markup.button.callback("❌ 拒否",`application:decide:${id}:declined`));
    buttons.push(controls);
   }
   const paging=[];
   if(page>0)paging.push(Markup.button.callback("◀ 前へ",
    `room:published:applicants:${announcementId}:${page-1}`));
   if((page+1)*3<total)paging.push(Markup.button.callback("次へ ▶",
    `room:published:applicants:${announcementId}:${page+1}`));
   if(paging.length)buttons.push(paging);
   buttons.push([Markup.button.callback("↩ 投稿管理へ戻る",
    `room:published:manage:${announcementId}`)]);
   const text="👥 応募者一覧\n"+escapeProfileHtml(String(source.rows[0].title))+
    "\n応募件数："+total+
    (blocks.length?"\n\n"+blocks.join("\n\n"):"\nまだ応募はありません。");
   const keyboard={parse_mode:"HTML" as const,...Markup.inlineKeyboard(buttons)};
   await ctx.answerCbQuery().catch(()=>undefined);
   try{
    await ctx.editMessageText(text,keyboard);
   }catch{
    // Old Telegram DM message may no longer be editable. Keep the list usable.
    await ctx.telegram.sendMessage(ctx.from.id,text,keyboard);
   }
  }catch(err){
   const category=err instanceof Error?err.name:"unknown";
   console.warn("[ROOM_APPLICANTS_OWNER_VIEW_FAILED]",category);
   await ctx.answerCbQuery("応募一覧を表示できません。DMを開き直してください。")
    .catch(()=>undefined);
  }
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
   const changed=await updateRoomState(ctx.from.id,pub.roomId,rev,action as "start"|"finish"|"cancel");
   // The ROOM DB state is authoritative. Telegram cards are confirmed
   // separately and must not be claimed updated until read back.
   let display:"confirmed"|"pending"|"not_enabled"="pending";
   try{
    if(changed.eventId)display=await reconcileRoomPublicCard(ctx.telegram,changed.eventId);
   }catch{
    console.warn("[ROOM_PUBLIC_SYNC_NEEDS_RECONCILE]");
   }
   await ctx.answerCbQuery(display==="confirmed"?
    (action==="start"?"開始・掲示板LIVE反映済み":"終了・掲示板反映済み"):
    "ROOM状態を保存しました。掲示板表示は更新確認中").catch(()=>undefined);
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
    const day=String(current.data.pickerDay||"");
    const value=current.module==="room"&&validPickerDay(day)&&/^\d{1,2}:\d{2}$/.test(input)?
     pickerDateLabel(day)+" "+input:input;
    const date=parseJstDateTime(value);
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
    const hasDetails=Boolean(String(current.data.title||"").trim());
    const updated=await updateDraft(ctx.from.id,"room",current.revision,
     hasDetails?"preview":"awaiting_text",
     {...current.data,externalUrl,stage:"details"});
    await roomPreviewScreen(ctx.telegram,ctx.from.id,updated);
    return;
   }
   if(current.module==="link"){
    const button=parseLinkButtonPair(input);
    const previous=Array.isArray(current.data.buttons)?
      current.data.buttons as LinkDraft["buttons"]:[];
    const replacing=current.data.linkEditMode==="replace"&&previous.length>0;
    const oldColumns=Number(current.data.columns||1);
    const normalized=previous.map((item,i)=>({...item,
     rowStart:typeof item.rowStart==="boolean"?item.rowStart:i===0||i%oldColumns===0}));
    const positioned={...button,rowStart:replacing?
     (normalized[normalized.length-1]?.rowStart??true):
     current.data.linkPlacement!=="beside"};
    const buttons=replacing?[...normalized.slice(0,-1),positioned]:
     [...normalized,positioned];
    const updated=await updateDraft(ctx.from.id,"link",current.revision,"preview",
      {...current.data,text:String(current.data.text||"🔗 リンク投稿"),
       buttons,linkEditMode:null,linkPlacement:null,linkEditorView:false,
       columns:[1,2,3].includes(Number(current.data.columns))?current.data.columns:1});
    await render(updated,"公開前プレビュー\n"+preview("link",updated),
      linkPreviewKeyboard(updated));
    return;
   }
   if(current.module==="room"){
    // Instant and scheduled ROOM share the one-shot Recruitment parser.
    const parsed=parseRecruitmentMessage(input,current.data.recruitmentMode==="linked");
    data={...current.data,...parsed,title:parsed.title,description:parsed.body,
     position:current.data.position??null,editField:null};
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
 bot.action(/^post:link:(panel|add|beside|edit|cancel|back|destination):(\d+)$/,async ctx=>{
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
  if(op==="panel"){
   if(d.step!=="preview"){await ctx.answerCbQuery("操作中です。");return;}
   const next=await updateDraft(ctx.from.id,"link",rev,"preview",
    {...d.data,linkEditorView:true});
   await ctx.answerCbQuery();
   await showPostScreen(ctx.telegram,ctx.from.id,next,
    linkEditorSummary(next),linkEditKeyboard(next));
   return;
  }
  if(op==="add"||op==="beside"||op==="edit"){
   if(d.step!=="preview"||d.data.linkEditorView!==true){
    await ctx.answerCbQuery("編集画面を開いてください。");return;
   }
   const next=await updateDraft(ctx.from.id,"link",rev,"awaiting_text",
    {...d.data,linkEditMode:op==="edit"?"replace":"add",
     linkPlacement:op==="beside"?"beside":"nextRow"});
   await ctx.answerCbQuery();
   await showPostScreen(ctx.telegram,ctx.from.id,next,
    (op==="edit"?"📝 最後のボタンを編集":op==="beside"?
     "➡️ 右横にボタンを追加":"➕ 次の行にボタンを追加")+
    "\n1行目：ボタン名\n2行目：https://URL\n2行をまとめて1回送信してください。",
    Markup.inlineKeyboard([[Markup.button.callback("↩ プレビューに戻る",
     "post:link:back:"+next.revision)],
     [Markup.button.callback("キャンセル","post:link:cancel:"+next.revision)]]));
   return;
  }
  if(op==="destination"){
   if(d.step!=="preview"||d.data.linkEditorView===true||
      !Array.isArray(d.data.buttons)||!d.data.buttons.length){
    await ctx.answerCbQuery("先にリンクボタンを追加してください。");return;
   }
   await ctx.answerCbQuery();
   await destinationMenu(ctx,"link",rev);
   return;
  }
  if(!Array.isArray(d.data.buttons)||!d.data.buttons.length){
   await ctx.answerCbQuery("先にリンクを入力してください。");return;
  }
  const next=await updateDraft(ctx.from.id,"link",rev,"preview",
   {...d.data,linkEditorView:false,linkEditMode:null,linkPlacement:null});
  await ctx.answerCbQuery();
  await showPostScreen(ctx.telegram,ctx.from.id,next,
   "公開前プレビュー\n"+preview("link",next),linkPreviewKeyboard(next));
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
   // ROOM is always routed through verified origin + same-group video Topic.
   // The old generic single-topic selector must not publish a ROOM.
   if(module==="room"){
    const current=await getDraft(ctx.from.id,"room");
    if(!current||current.revision!==rev)throw Error("ROOM_DRAFT_STALE");
    await ctx.answerCbQuery();
    if(!await roomPublishConfirmation(ctx.telegram,ctx.from.id,current))
     await roomPreviewScreen(ctx.telegram,ctx.from.id,current);
    return;
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
  await ctx.answerCbQuery();
  await editMessageToDmPostingMenu(ctx,ctx.from.id);
 });
 async function publishAccepted(
 ctx:Context & {from:NonNullable<Context["from"]>;
  callbackQuery:NonNullable<Context["callbackQuery"]>},
 module:Module,revision:number,topicId:number,
):Promise<void>{
  await ctx.answerCbQuery("公開処理を確認しています");
  let roomSourceMayExist=false;
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
   if(module==="room"&&roomDraft&&hasExplicitRoomTopicChoice(roomDraft.data)){
    if(roomDraft.step!=="preview"||roomDraft.revision!==revision||
       Number(roomDraft.data.selectedTopicId)!==topicId)
     throw Error("ROOM_EXPLICIT_DESTINATION_STALE");
   }else await assertTopicDmEntryDestination(ctx.from.id,destination.chatId,destination.threadId);
   if(module==="room"&&roomTargets){
    await verifyRoomPublicationPreflight(ctx.telegram,ctx.from.id,roomTargets,
     roomDraft?.data.profileLinked===true);
   }
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
     // A failed database write may still have committed. Do not offer a new
     // revision/request key after source creation becomes uncertain.
     roomSourceMayExist=true;
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
     // Published URL buttons share the same responsive 4/3/2 layout as
     // ROOM applicant selections. Keep the original actions and their order.
     // Telegram decides actual pixel widths; paired rows avoid tall,
     // inconsistently sized single-button rows for 2–4 actions.
     const profileUrl=draft.data.profileLinked?
       await existingPublishedProfileUrl(ctx.from.id):undefined;
     if(draft.data.profileLinked&&!profileUrl)
      throw new Error("ROOM_PUBLIC_PROFILE_NOT_AVAILABLE");
     const publicActions=roomPublicButtons({
      visibility:visibility==="approved_only"?"approved_only":"public",
      state:isScheduledRoom?"scheduled":"live",
      applicationUrl:visibility==="approved_only"?
       await makeApplicationLink(ctx.from.id,Number(sourceId)):undefined,
      joinUrl:await makeRoomJoinLink(ctx.from.id,roomId),
      profileUrl:profileUrl??undefined,
     });
     buttons=adaptiveChoiceRows(publicActions);
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
      // Explicit "即開始" selection starts the existing ROOM only after
      // both Telegram destinations acknowledge sends.
      if(!isScheduledRoom){
       const eventId=await ensureImmediatePublishedRoomLive(ctx.from.id,Number(sourceId));
       if(eventId){
        try{
         const state=await reconcileRoomPublicCard(ctx.telegram,eventId);
         if(state!=="confirmed")console.warn("[ROOM_IMMEDIATE_PUBLIC_CARD_PENDING]");
        }catch{
         console.warn("[ROOM_IMMEDIATE_PUBLIC_CARD_NEEDS_RECONCILE]");
        }
       }
      }
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
   console.error("[POST_PUBLICATION_FAILED]",{module,revision,reason:msg});
   if(module==="room"&&roomSourceMayExist){
    // Fully ACKed Telegram receipts are authoritative; recover the
    // existing DM editor without sending either post a second time.
    try{
     const targets=await verifiedRoomTargets(ctx.from.id);
     const completed=await recoverFullySentRoom(ctx.from.id,revision,
      targets.map(t=>t.topicId));
     if(completed){
      const draft=await getDraft(ctx.from.id,"room");
      if(draft?.data.stage==="immediate_ready")
       {
        const eventId=await ensureImmediatePublishedRoomLive(ctx.from.id,completed);
        if(eventId){
         try{
          const status=await reconcileRoomPublicCard(ctx.telegram,eventId);
          if(status!=="confirmed")console.warn("[ROOM_RECOVERY_PUBLIC_CARD_PENDING]");
         }catch{
          console.warn("[ROOM_RECOVERY_PUBLIC_CARD_NEEDS_RECONCILE]");
         }
        }
       }
      if(draft?.revision===revision&&draft.step==="preview")
       await markDraftPublished(ctx.from.id,"room",revision).catch(err=>
        console.error("[ROOM_DRAFT_CLEANUP_FAILED]",
         err instanceof Error?err.message:"unknown"));
      const screenId="message" in ctx.callbackQuery?
       ctx.callbackQuery.message?.message_id:undefined;
      await showRoomPublished(ctx.telegram,ctx.from.id,completed,screenId);
      return;
     }
    }catch(recoveryError){
     console.error("[ROOM_RECEIPT_RECOVERY_FAILED]",
      recoveryError instanceof Error?recoveryError.message:"unknown");
    }
   }
   const uncertain=roomSourceMayExist||msg==="PUBLISH_NEEDS_RECONCILE"||
    msg==="POST_SENT_SOURCE_SYNC_NEEDS_RECONCILE"||
    msg==="POST_DRAFT_FINALIZATION_NEEDS_RECONCILE";
   if(module==="room"){
    // A plan callback already advances the draft revision before publication.
    // Refresh its screen from the saved draft, never reuse stale callback data.
    const current=await getDraft(ctx.from.id,"room").catch(()=>null);
    if(current&&current.step==="preview"&&current.revision===revision){
     if(uncertain){
      const targets=await verifiedRoomTargets(ctx.from.id).catch(()=>[]);
      const safe=targets.length>0&&await mayResumeRoomPublication(ctx.from.id,revision,
       targets.map(t=>t.topicId)).catch(()=>false);
      await showPostScreen(ctx.telegram,ctx.from.id,current,
       safe?"⚠️ 投稿が完了していません。確認済みの送信は保持し、未送信分だけ再開できます。":
        "⚠️ ROOMの送信結果に未確認の記録があります。確認済みの投稿は再送しません。",
       Markup.inlineKeyboard([[
        Markup.button.callback(safe?"🔄 未送信分を再開":"🔄 投稿状態を確認","room:reconcile:"+revision)
       ]]));
     }else{
      await roomPreviewScreen(ctx.telegram,ctx.from.id,current);
     }
     return;
    }
   }
   await ctx.reply(uncertain?
    "投稿と元データの照合が必要です。重複投稿防止のため自動再送は行いません。":
    "投稿を確認できませんでした："+msg);
  }
 }
 bot.action(/^post:publish:(profile|room|announcement|link):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  await publishAccepted(ctx,ctx.match[1] as Module,Number(ctx.match[2]),Number(ctx.match[3]));
 });
}
