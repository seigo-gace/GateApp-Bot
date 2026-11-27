import {noticeParts,noticeText,noticeJoin,noticeMedia,noticeEdit,validateNotice,noticeCard,buildNoticeRichPreview,noticeUrlButton,noticeStickerPreviews,resolveNoticeDestination} from "../services/noticeEditor.js";
import {showPublishedNoticeOwner} from "./noticeInteractions.js";
import {prepareNoticeRich} from "../services/noticeRichMedia.js";
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
import { beginDraft,getDraft,getWaitingDraft,updateDraft,bindDraftScreen,bindNoticeStickerPreviews,createRoom,createLinkButton,markRoomDraftSaved,
 createAnnouncement,markDraftPublished,markPostSourcePublished,saveAnnouncementEditorDraft,type PostModule,type EditorDraft } from "../services/publicPostRepository.js";
import {BOARD_KEYS,BOARD_TITLES,type BoardKey,type PostPurpose,type VerifiedTopic} from "../services/topicRouting.js";
import { currentMenuOrigin } from "../services/menuOriginRepository.js";
import { currentTopicDmEntry,assertTopicDmEntryDestination,verifiedOriginTopic } from "../services/topicDmEntry.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import { PURPOSE_TAGS, validateAnnouncementTags, normalizePlaceCodes } from "../services/announcementTags.js";
import {parseLinkButtonPair,renderLinkCard,buttonGrid,insertLinkButton,type LinkDraft} from "../services/linkButtonDomain.js";
import {registerLinkShare,updateLinkShare} from "../services/linkInlineShare.js";
import {linkRichPreview,linkRichPlacement,linkRichContentEditor,linkUrlKeyboardRows,linkRichRegisteredReceipt} from "../services/linkRichPreview.js";
import {ownerUsernameLink} from "../services/telegramUsernameLink.js";
import {makeRoomJoinLink} from "../services/roomJoinLinks.js";
import {roomPublicButtons} from "../services/roomPublicButtons.js";
import {makeApplicationLink,makeNoticeApplicationLink} from "../services/applicationLinks.js";
import {updateRoomState,updateRoomDetails} from "../services/roomLifecycle.js";
import {reconcileRoomPublicCard} from "../services/roomPublicSync.js";
import {loadRoomPublication,roomPublicationEditor,deletePublishedRoom,recoverFullySentRoom,mayResumeRoomPublication,ensureImmediatePublishedRoomLive} from "../services/roomPublishedEditor.js";
import {showWizardScreen,removeUserWizardInput,wizardEditFailureKind,type WizardKeyboard} from "../services/dmWizardScreen.js";
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
/** Preview with media, tappable URL buttons and in-body edit callbacks. */
async function showLinkRichPreview(telegram:Telegram,owner:number,d:EditorDraft):Promise<void>{
 const registered=typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true;
 const rich=registered?
  linkRichRegisteredReceipt(String(d.data.shareCode)):
  linkRichPreview(d.data as LinkDraft,d.revision);
 const urlRows=registered?[]:linkUrlKeyboardRows(d.data as LinkDraft);
 const keyboard=registered?
  {reply_markup:{inline_keyboard:[
   [{text:"📋 登録コードをコピー",copy_text:{text:"@GayBBS_bot "+String(d.data.shareCode)}}],
   [{text:"戻る",callback_data:"post:link:receipt:back:"+d.revision},
    {text:"新規作成",callback_data:"post:link:receipt:new:"+d.revision},
    {text:"編集",callback_data:"post:link:receipt:edit:"+d.revision}],
  ]}}:
  {reply_markup:{inline_keyboard:[
   ...urlRows,
   [{text:"登録",callback_data:"post:link:register:"+d.revision},
    {text:"キャンセル",callback_data:"post:link:cancel:"+d.revision}],
  ]}};
 const raw=telegram as unknown as {callApi:(method:string,args:Record<string,unknown>)=>Promise<any>};
 const old=Number(d.data.screenMessageId);
 if(Number.isSafeInteger(old)&&old>0){
  try{
   await raw.callApi("editMessageText",{chat_id:owner,message_id:old,
    rich_message:rich,reply_markup:keyboard.reply_markup});
   return;
  }catch(error){
   const reason=error instanceof Error?error.message:"";
   if(/message is not modified/i.test(reason))return;
   // Telegram may reject editing a plain-text DM message into a media-rich
   // message with HTTP 400 even though a fresh sendRichMessage is valid.
   // A definite 400 response has no ambiguous in-flight edit side effect.
   const deterministicMediaEditReject=Boolean(d.data.media)&&
    /\b400\b/.test(reason)&&/bad request/i.test(reason);
   if(!/message can't be edited|there is no text in the message|message to edit not found/i.test(reason)&&
      !deterministicMediaEditReject)
    throw error;
  }
 }
 let sent:any;
 try{
  sent=await raw.callApi("sendRichMessage",{chat_id:owner,
   rich_message:rich,reply_markup:keyboard.reply_markup});
 }catch(error){
  const reason=error instanceof Error?error.message:"";
  // A known Telegram 400 has no uncertain send side effect. For media-only
  // errors retain the exact draft and show a recoverable editor screen.
  // Timeout / transport ambiguity is rethrown: never blindly duplicate a post.
  if(!d.data.media||!/\b400\b/.test(reason)||!/bad request/i.test(reason))throw error;
  await showPostScreen(telegram,owner,d,
   "⚠️ 素材を含むプレビューを表示できませんでした。下書きは保持しています。"+
   "\n素材を変更するか、再表示をお試しください。",
   Markup.inlineKeyboard([
    [Markup.button.callback("素材変更","post:link:editmedia:"+d.revision),
     Markup.button.callback("再表示","post:link:back:"+d.revision)],
    [Markup.button.callback("キャンセル","post:link:cancel:"+d.revision)],
   ]));
  return;
 }
 if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)
  throw Error("LINK_RICH_SCREEN_UNCONFIRMED");
 await bindDraftScreen(owner,"link",d.revision,sent.message_id);
 if(old>0&&old!==sent.message_id){
  try{await telegram.deleteMessage(owner,old);}catch{
   console.warn("[LINK_OLD_SCREEN_REMOVE_FAILED]");
  }
 }
}


async function showLinkRichEditor(telegram:Telegram,owner:number,d:EditorDraft):Promise<void>{
 const rich=d.data.linkEditorView==="content"?linkRichContentEditor(d.data as LinkDraft,d.revision,String(d.data.linkSelectedField||'')):
   linkRichPlacement(d.data as LinkDraft,d.revision);
 const keyboard=Markup.inlineKeyboard(d.data.linkEditorView==="content"?[[
  Markup.button.callback("戻る","post:link:back:"+d.revision),
  Markup.button.callback("変更","post:link:change:"+d.revision),
  Markup.button.callback("キャンセル","post:link:cancel:"+d.revision),
 ]]:[[
  Markup.button.callback("戻る","post:link:back:"+d.revision),
  Markup.button.callback("キャンセル","post:link:cancel:"+d.revision),
 ]]);
 const raw=telegram as unknown as {callApi:(method:string,args:Record<string,unknown>)=>Promise<any>};
 const old=Number(d.data.screenMessageId);
 if(Number.isSafeInteger(old)&&old>0){
  try{
   await raw.callApi("editMessageText",{chat_id:owner,message_id:old,
    rich_message:rich,reply_markup:keyboard.reply_markup});
   return;
  }catch(error){
   const reason=error instanceof Error?error.message:"";
   if(/message is not modified/i.test(reason))return;
   if(!/message can't be edited|there is no text in the message|message to edit not found/i.test(reason))
    throw error;
  }
 }
 const sent=await raw.callApi("sendRichMessage",{chat_id:owner,rich_message:rich,reply_markup:keyboard.reply_markup});
 if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)
  throw Error("LINK_EDITOR_SCREEN_UNCONFIRMED");
 await bindDraftScreen(owner,"link",d.revision,sent.message_id);
 if(old>0&&old!==sent.message_id){
  try{await telegram.deleteMessage(owner,old);}catch{
   console.warn("[LINK_OLD_EDITOR_REMOVE_FAILED]");
  }
 }
}


function linkMediaEditorKeyboard(d:EditorDraft):WizardKeyboard{
 const rev=d.revision;
 const withCaption=Boolean(d.data.media)&&Boolean(String(d.data.text||"").trim());
 const top=d.data.captionAbove===true;
 return Markup.inlineKeyboard([
  ...(withCaption?[[
   Markup.button.callback((top?"✅ ":"▫️ ")+"上に表示","post:link:captiontop:"+rev),
   Markup.button.callback((!top?"✅ ":"▫️ ")+"下に表示","post:link:captionbottom:"+rev),
  ]]:[]),
  [Markup.button.callback("🖼 画像/動画の差し替え","post:link:mediareplace:"+rev),
   Markup.button.callback("🗑 画像/動画を削除","post:link:mediadelete:"+rev)],
  [Markup.button.callback("↩ プレビューに戻る","post:link:back:"+rev),
   Markup.button.callback("キャンセル","post:link:cancel:"+rev)],
 ]);
}

/** Only these two actions belong in the preview InlineKeyboard. */
export function linkPreviewKeyboard(d:EditorDraft):WizardKeyboard{
 return Markup.inlineKeyboard([[
  Markup.button.callback("登録","post:link:register:"+d.revision),
  Markup.button.callback("キャンセル","post:link:cancel:"+d.revision),
 ]]);
}
function linkColorKeyboard(d:EditorDraft):WizardKeyboard{
 const colors=[["標準","standard"],["青","primary"],["緑","success"],["赤","danger"]] as const;
 const selected=String(d.data.linkSelectedStyle||"standard");
 return Markup.inlineKeyboard([
  colors.map(([name,color])=>Markup.button.callback((selected===color?"✅ ":"▫️ ")+name,
   "post:link:selectcolor:"+d.revision+":"+color)),
  [Markup.button.callback("戻る","post:link:restart:"+d.revision),
   Markup.button.callback("キャンセル","post:link:cancel:"+d.revision)],
 ]);
}
export async function startLinkEditor(telegram:Telegram,userId:number,screenId?:number):Promise<void>{
 const prior=await getDraft(userId,"link");
 // A registered post has its immutable code in link_button_posts. Re-entering
 // ［🔗ボタン作成］ must start a NEW draft, not reopen a locked receipt.
 const reusable=prior&&typeof prior.data.shareCode!=="string"?prior:null;
 if(screenId&&reusable){
  await bindDraftScreen(userId,"link",reusable.revision,screenId);
  reusable.data.screenMessageId=screenId;
 }
 if(reusable?.step==="preview"){
  if(reusable.data.linkEditorView===true||reusable.data.linkEditorView==="content")
   await showLinkRichEditor(telegram,userId,reusable);
  else await showLinkRichPreview(telegram,userId,reusable);
  return;
 }
 const d=reusable?.step==="awaiting_text"?reusable:
  await beginDraft(userId,"link","awaiting_text",{
   linkStage:"content",buttons:[],text:"",columns:1,linkSelectedStyle:"standard",
   ...(screenId?{screenMessageId:screenId}:{})});
 const buttonStage=String(d.data.linkStage||"content")==="button";
 await showPostScreen(telegram,userId,d,buttonStage?
  "🔗 ボタンを作成\nリンクにしたいURLとボタンのタイトルを2行で送信してください。\n1行目：ボタンのタイトル\n2行目：ボタンにしたいURL":
  "🔗ボタンを作成する上で一緒に投稿したテキスト、動画、画像、ステッカーなどを投稿してください。動画や画像に説明を補足した場合はキャプションにテキストを入力してください。",
  buttonStage?linkColorKeyboard(d):Markup.inlineKeyboard([[
   Markup.button.callback("キャンセル","post:link:cancel:"+d.revision)]]));
}

/** One shared Bot DM message for the approved 告知/予告 layout. */
export function announcementPanel(d:EditorDraft):WizardKeyboard{
 const rev=d.revision;
 const b=(text:string,op:string)=>Markup.button.callback(text,`post:announce:${op}:${rev}`);
 return Markup.inlineKeyboard([[b("投稿する","publish"),b("キャンセル","cancel"),b("下書き保存","save")]]);
}
export function announcementSummary(d:EditorDraft):string{
 const {title,body}=noticeParts(d.data);
 const dt=(v:unknown)=>v?new Date(String(v)).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}):"［未設定］";
 const join=noticeJoin(d.data);
 return ["📢 告知/予告",
  title?"タイトル："+escapeProfileHtml(title):"タイトル：［未設定］",
  body?"説明："+escapeProfileHtml(body):"説明：［未設定］",
  "開催日時："+dt(d.data.eventAt),
  "受付期限："+dt(d.data.deadlineAt),
  "参加方法："+(join==="public"?"自由参加":join==="approved_only"?"承認制":"［未設定］"),
  ...(d.data.destinationLabel?["投稿先："+escapeProfileHtml(String(d.data.destinationLabel))]:[])
 ].join("\n");
}
/** Reuse the established Room date picker for notice dates and deadlines. */
async function announcementDatePicker(t:Telegram,id:number,d:EditorDraft):Promise<void>{
 const rev=d.revision,stage=String(d.data.noticePickerStage||"date_calendar");
 const field=d.data.noticeDateField==="deadline"?"deadline":"event";
 const actions={
  month:(v:string)=>`post:announce:dt:month:${rev}:${v}`,
  day:(v:string)=>`post:announce:dt:day:${rev}:${v}`,
  hour:(v:string)=>`post:announce:dt:hour:${rev}:${v}`,
  minute:(v:string)=>`post:announce:dt:minute:${rev}:${v}`,
  manual:`post:announce:dt:manual:${rev}`,
  back:`post:announce:back:${rev}`,
  cancel:`post:announce:back:${rev}`,
 };
 const month=String(d.data.pickerMonth||"");
 const rows=stage==="date_calendar"?
  pickerDateRows(validPickerMonth(month)?month:jstCurrentMonth(),actions):
  stage==="time_hour"?pickerHourRows(actions):pickerMinuteRows(actions);
 rows.push([Markup.button.callback("設定を解除",`post:announce:dt:clear:${rev}`)]);
 await showPostScreen(t,id,d,(field==="deadline"?"📅 受付終了日時":"📅 開催日時")+
  "（日本時間）を選択してください。",Markup.inlineKeyboard(rows));
}
/** Stickers cannot be embedded in Rich Messages. Keep native copies tracked by
 * the same draft; never resend an ambiguous pending copy automatically. */
async function clearNoticeStickerPreviews(t:Telegram,id:number,data:Record<string,unknown>):Promise<void>{
 for(const p of noticeStickerPreviews(data)){
  if(p.messageId===null)continue;
  try{await t.deleteMessage(id,p.messageId);}catch{console.warn("[NOTICE_STICKER_PREVIEW_REMOVE_FAILED]");}
 }
}
async function announcementScreen(telegram:Telegram,userId:number,d:EditorDraft,error?:string,withStickers=true):Promise<boolean>{
 if(["date_calendar","time_hour","time_minute"].includes(String(d.data.noticePickerStage||""))){
  await announcementDatePicker(telegram,userId,d);return true;
 }
 if(!Number.isSafeInteger(userId)||userId<=0||d.module!=="announcement"||d.data.kind==="recruitment")
  throw Error("NOTICE_PRIVATE_SCREEN_REQUIRED");
 const rich=await prepareNoticeRich(telegram,d.data,d.revision,error,withStickers);
 const reply_markup=announcementPanel(d).reply_markup;
 const raw=telegram as unknown as {callApi:(method:string,args:Record<string,unknown>)=>Promise<unknown>};
 const old=Number(d.data.screenMessageId);
 const hasOld=Number.isSafeInteger(old)&&old>0;
 let screenId=hasOld?old:undefined;
 if(hasOld){
  try{
   await raw.callApi("editMessageText",{chat_id:userId,message_id:old,...rich.payload,reply_markup});
  }catch(error){
   const failure=wizardEditFailureKind(error);
   if(failure==="rejected")screenId=undefined;
   else if(failure!=="unchanged")throw error;
  }
 }
 if(screenId===undefined){
  const sent=await raw.callApi("sendRichMessage",{chat_id:userId,...rich.payload,reply_markup}) as {message_id?:number}|null;
  const id=sent?.message_id;
  if(typeof id!=="number"||!Number.isSafeInteger(id)||id<=0)
   throw Error("NOTICE_RICH_SCREEN_UNCONFIRMED");
  await bindDraftScreen(userId,"announcement",d.revision,id);
  screenId=id;
  if(hasOld&&old!==screenId){
   try{await telegram.deleteMessage(userId,old);}
   catch{console.warn("[NOTICE_OLD_SCREEN_REMOVE_FAILED]");}
  }
 }
 // Retire only tracked native copies from earlier deployed versions.
 if(noticeStickerPreviews(d.data).length){
  await clearNoticeStickerPreviews(telegram,userId,d.data);
  await bindNoticeStickerPreviews(userId,d.revision,[]);
 }
 // Retire only the previously tracked private notice preview copies.
 const legacy=Array.isArray(d.data.noticePreviewIds)?d.data.noticePreviewIds:[];
 for(const id of new Set(legacy)){
  if(typeof id!=="number"||!Number.isSafeInteger(id)||id<=0||id===screenId||id===old)continue;
  try{await telegram.deleteMessage(userId,id);}
  catch{console.warn("[NOTICE_LEGACY_PREVIEW_REMOVE_FAILED]");}
 }
 return rich.ready;
}
async function showNoticeEditorError(t:Telegram,id:number,d:EditorDraft,message:string,withStickers=true){
 try{await announcementScreen(t,id,{...d,data:{...d.data,noticePickerStage:null}},message,withStickers);}
 catch{
  const screen=Number(d.data.screenMessageId);
  if(Number.isSafeInteger(screen)&&screen>0){
   try{await t.editMessageText(id,screen,undefined,announcementSummary(d)+"\n\n⚠️ "+message,announcementPanel(d));}
   catch{console.warn("[NOTICE_EDITOR_ERROR_EDIT_FAILED]");}
  }
 }
}
async function currentNoticeOrigin(userId:number){
 return await currentTopicDmEntry(userId)??await currentMenuOrigin(userId);
}
async function announcementDestinationPicker(telegram:Telegram,userId:number,d:EditorDraft,
 options:readonly VerifiedTopic[],page=0):Promise<void>{
 const pageSize=10,last=Math.max(0,Math.ceil(options.length/pageSize)-1);
 page=Math.max(0,Math.min(last,page));
 const rows=options.slice(page*pageSize,(page+1)*pageSize).map(t=>[
  Markup.button.callback(BOARD_TITLES[t.board]+" / "+t.title,`post:choose:announcement:${d.revision}:${t.id}`)]);
 const navigation=[];
 if(page>0)navigation.push(Markup.button.callback("⬅ 前へ",`post:announce:topicpage:${d.revision}:${page-1}`));
 if(page<last)navigation.push(Markup.button.callback("次へ ➡",`post:announce:topicpage:${d.revision}:${page+1}`));
 if(navigation.length)rows.push(navigation);
 rows.push([Markup.button.callback("↩ 戻る",`post:announce:back:${d.revision}`)]);
 await showPostScreen(telegram,userId,d,options.length?
  "入口のトピックが不明です。投稿先を選択してください。（"+(page+1)+"/"+(last+1)+"）":
  "投稿できるトピックが確認できません。下書きは保持しています。",Markup.inlineKeyboard(rows));
}
async function showNoticeOriginUnavailable(t:Telegram,id:number,d:EditorDraft){
 await showPostScreen(t,id,d,"入口のトピックに告知/予告の投稿先登録がありません。別のトピックには投稿しません。下書きは保持しています。",
  Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",`post:announce:back:${d.revision}`)]]));
}
/** Announcement is selected by its menu, not by an extra mandatory kind page. */
export async function startAnnouncementEditor(telegram:Telegram,userId:number,screenId?:number):Promise<void>{
 const existing=await getDraft(userId,"announcement");
 if(screenId&&existing){
  await bindDraftScreen(userId,"announcement",existing.revision,screenId);
  existing.data.screenMessageId=screenId;
 }
 if(existing?.step==="saved"&&existing.data.kind!=="recruitment"){
  const {savedTemplate:_previous,noticeStickerPreviews:_receipts,...template}=existing.data;
  await clearNoticeStickerPreviews(telegram,userId,existing.data);
  const resumed=await updateDraft(userId,"announcement",existing.revision,
   (noticeText(template).trim()||noticeMedia(template).length)?"preview":"awaiting_text",
   {...template,savedTemplate:template});
  await announcementScreen(telegram,userId,resumed);
  return;
 }
 if(existing&&["preview","awaiting_text","awaiting_datetime","awaiting_media"].includes(existing.step)&&
    existing.data.kind!=="recruitment"){
  if(existing.step==="awaiting_datetime"){
   await showPostScreen(telegram,userId,existing,
    "📅 日時を日本時間で1通送信してください。例：2026/11/20 20:00",
    Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",
     `post:announce:back:${existing.revision}`)]]));
  }else if(existing.step==="awaiting_media"){
    await showPostScreen(telegram,userId,existing,"画像・動画・ステッカーを送信してください（合計最大5件）。「なし」で解除、［戻る］でプレビューへ。",
     Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",`post:announce:back:${existing.revision}`)]]));
   }else if(existing.step==="awaiting_text"){
    const prompt="1行目：タイトル\n2行目：説明\n画像・動画・ステッカーもこの画面で送信できます。素材があれば文章は省略できます。";
    await showPostScreen(telegram,userId,existing,prompt,
     Markup.inlineKeyboard([[Markup.button.callback("キャンセル",`post:announce:cancel:${existing.revision}`)]]));
   }else await announcementScreen(telegram,userId,existing);
  return;
 }
 const draft=await beginDraft(userId,"announcement","awaiting_text",
  {kind:"announcement",participation:"none",editField:"initial",...(screenId?{screenMessageId:screenId}:{})});
 await showPostScreen(telegram,userId,draft,"1行目：タイトル\n2行目：説明\n画像・動画・ステッカーもここで送信してください。素材がある場合、タイトル・説明は省略できます。",
  Markup.inlineKeyboard([[Markup.button.callback("キャンセル",`post:announce:cancel:${draft.revision}`)]]));
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
   const keyboard=Markup.inlineKeyboard(buttons);
   await ctx.answerCbQuery().catch(()=>undefined);
   const tapped=ctx.callbackQuery&&"message" in ctx.callbackQuery
    ?ctx.callbackQuery.message?.message_id:undefined;
   // One shared DM screen lifecycle: only an explicit Telegram edit rejection
   // creates a fallback; network ambiguity must not duplicate applicant lists.
   await showWizardScreen(ctx.telegram,ctx.from.id,tapped,text,keyboard,"HTML");
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
 bot.action(/^post:announce:(title|body|date|deadline|link|media|joinmenu|join|destination|topics|back|publish|save|cancel):(\d+)(?::(public|approved_only|none))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]);
  const kindChoice=ctx.match[3];
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.revision!==rev||!["preview","awaiting_text","awaiting_datetime","awaiting_media"].includes(d.step)||
     d.data.kind==="recruitment"){
   await ctx.answerCbQuery("古い操作です。投稿メニューから再度お試しください。");return;
  }
  if(["title","body","date","deadline","link","media","joinmenu"].includes(op)){
   const message="message" in ctx.callbackQuery?ctx.callbackQuery.message:undefined;
   const editable=d.step==="preview"||(d.step==="awaiting_text"&&d.data.editField==="initial"&&noticeMedia(d.data).length>0);
   if(ctx.chat?.id!==ctx.from.id||message?.chat.id!==ctx.from.id||
      !Number.isSafeInteger(d.data.screenMessageId)||message?.message_id!==d.data.screenMessageId||
      !editable||d.data.noticePickerStage||kindChoice!==undefined){
    await ctx.answerCbQuery("古い編集操作です。告知/予告を開き直してください。");return;
   }
  }
  try{
   if(["title","body","deadline","link","media"].includes(op)){
     const editField=op;
     const next=await updateDraft(ctx.from.id,"announcement",rev,
      editField==="media"?"awaiting_media":editField==="deadline"?"preview":"awaiting_text",
      editField==="deadline"?{...d.data,noticePickerStage:"date_calendar",noticeDateField:"deadline",
       pickerMonth:jstCurrentMonth(),pickerDay:null,pickerHour:null}:
       {...d.data,editField});
    await ctx.answerCbQuery();
    if(editField==="deadline"){
      await announcementDatePicker(ctx.telegram,ctx.from.id,next);
      return;
     }
     await showPostScreen(ctx.telegram,ctx.from.id,next,
     ({initial:"1行目：タイトル\n2行目：説明（画像・動画がある場合は省略可能）",title:"タイトルを入力してください。",body:"内容を入力してください。",
       deadline:"受付終了日時（YYYY/MM/DD HH:mm）または「なし」を入力してください。",
       link:(noticeUrlButton(d.data)?"現在のボタン："+noticeUrlButton(d.data)!.text+"\n現在のURL："+noticeUrlButton(d.data)!.url+"\n\n":"")+"1行目：ボタン名\n2行目：HTTPS URL\n登録後はプレビューでボタンをタップして確認できます。「なし」で解除できます。",
       media:"画像・動画・ステッカーを送信してください（合計最大5件）。「なし」で解除できます。"}[editField]||"本文を入力してください。"),
     Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",
      `post:announce:back:${next.revision}`)]]));
   }else if(op==="joinmenu"){
     await ctx.answerCbQuery();
     await showPostScreen(ctx.telegram,ctx.from.id,d,"参加方法を選択してください。",Markup.inlineKeyboard([
      [Markup.button.callback("自由参加",`post:announce:join:${rev}:public`),Markup.button.callback("承認制",`post:announce:join:${rev}:approved_only`)],
      [Markup.button.callback("設定を解除",`post:announce:join:${rev}:none`)],
      [Markup.button.callback("↩ 戻る",`post:announce:back:${rev}`)]
     ]));
    }else if(op==="join"){
     if(!["none","public","approved_only"].includes(String(kindChoice)))throw Error("ANNOUNCEMENT_JOIN_INVALID");
     const next=await updateDraft(ctx.from.id,"announcement",rev,"preview",
      {...d.data,participation:kindChoice});
     await ctx.answerCbQuery();await announcementScreen(ctx.telegram,ctx.from.id,next);
    }else if(op==="date"){
     const next=await updateDraft(ctx.from.id,"announcement",rev,"preview",
      {...d.data,noticePickerStage:"date_calendar",noticeDateField:"event",
       pickerMonth:jstCurrentMonth(),pickerDay:null,pickerHour:null});
     await ctx.answerCbQuery();
     await announcementDatePicker(ctx.telegram,ctx.from.id,next);
    }else if(op==="destination"||op==="publish"||op==="topics"){
    if(!noticeText(d.data).trim()&&!noticeMedia(d.data).length){
     await ctx.answerCbQuery("文章または画像・動画・ステッカーを登録してください。");return;
    }
    const origin=await currentNoticeOrigin(ctx.from.id);
    const options=await listVerifiedTopics("announcement");
    const route=resolveNoticeDestination(options,origin,d.data);
    if(route.kind==="unavailable"){
     await ctx.answerCbQuery();
     await showNoticeOriginUnavailable(ctx.telegram,ctx.from.id,d);return;
    }
    if(route.kind==="direct"){
     const selected=route.topic;
     const label=BOARD_TITLES[selected.board]+" / "+selected.title;
     const explicit=!origin;
     const current=d.step==="preview"&&d.data.topicId===selected.id&&
       d.data.destinationLabel===label&&d.data.noticeDestinationExplicit===explicit?d:
      await updateDraft(ctx.from.id,"announcement",rev,"preview",
       {...d.data,topicId:selected.id,destinationLabel:label,noticeDestinationExplicit:explicit,editField:null});
     if(op==="publish"){
      if(current.revision!==rev)await announcementScreen(ctx.telegram,ctx.from.id,current);
      await publishAccepted(ctx,"announcement",current.revision,selected.id);
     }else{
      await ctx.answerCbQuery();
      await announcementScreen(ctx.telegram,ctx.from.id,current);
     }
     return;
    }
    const current=d.step==="preview"?d:await updateDraft(ctx.from.id,"announcement",rev,"preview",{...d.data,editField:null});
    await ctx.answerCbQuery();
    await announcementDestinationPicker(ctx.telegram,ctx.from.id,current,route.topics);
   }else if(op==="back"){
    const next=await updateDraft(ctx.from.id,"announcement",rev,
     (noticeText(d.data).trim()||noticeMedia(d.data).length)?"preview":"awaiting_text",
      {...d.data,noticePickerStage:null,noticeDateField:null,editField:null});
    await ctx.answerCbQuery();await announcementScreen(ctx.telegram,ctx.from.id,next);
   }else if(op==="save"){
    await saveAnnouncementEditorDraft(ctx.from.id,rev);
    if(noticeStickerPreviews(d.data).length){
     await clearNoticeStickerPreviews(ctx.telegram,ctx.from.id,d.data);
     await bindNoticeStickerPreviews(ctx.from.id,rev,[]);
    }
    await ctx.answerCbQuery("下書きを保存しました");
    await ctx.editMessageText("✅ 告知/予告を非公開保存しました。投稿メニューから再開できます。");
   }else if(op==="cancel"){
    const old=d.data.savedTemplate;
    const saved=old&&typeof old==="object"&&!Array.isArray(old)?
     old as Record<string,unknown>:null;
    await updateDraft(ctx.from.id,"announcement",rev,saved?"saved":"cancelled",
     saved?{...saved,noticeStickerPreviews:[]}:{cancelled:true});
    await clearNoticeStickerPreviews(ctx.telegram,ctx.from.id,d.data);
    await ctx.answerCbQuery();
    await editMessageToDmPostingMenu(ctx,ctx.from.id);
   }
  }catch{
   await ctx.answerCbQuery("操作できません。投稿メニューから再度お試しください。");
  }
 });
 bot.action(/^post:announce:topicpage:(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]),page=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.revision!==rev||d.step!=="preview"||d.data.kind==="recruitment"){
   await ctx.answerCbQuery("古い操作です。");return;
  }
  const origin=await currentNoticeOrigin(ctx.from.id);
  const options=await listVerifiedTopics("announcement");
  const route=resolveNoticeDestination(options,origin,d.data);
  await ctx.answerCbQuery();
  if(route.kind==="choose")await announcementDestinationPicker(ctx.telegram,ctx.from.id,d,route.topics,page);
  else if(route.kind==="unavailable")await showNoticeOriginUnavailable(ctx.telegram,ctx.from.id,d);
  else await announcementScreen(ctx.telegram,ctx.from.id,d);
 });
 bot.action(/^post:announce:dt:(month|day|hour|minute|manual|clear):(\d+)(?::(\d{2,8}))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]),value=ctx.match[3]||"";
  const d=await getDraft(ctx.from.id,"announcement");
  const stage=String(d?.data.noticePickerStage||"");
  if(!d||d.step!=="preview"||d.revision!==rev||
   d.data.kind==="recruitment"||
   !["date_calendar","time_hour","time_minute"].includes(stage)){
   await ctx.answerCbQuery("古い日時選択です");return;
  }
  try{
   let data={...d.data};
   if(op==="clear"){
    data={...data,
     [data.noticeDateField==="deadline"?"deadlineAt":"eventAt"]:null,
     noticePickerStage:null,noticeDateField:null,pickerDay:null,pickerHour:null};
   }else if(op==="month"){
    if(stage!=="date_calendar"||!validPickerMonth(value))throw Error("NOTICE_DATE_MONTH");
    data={...data,pickerMonth:value};
   }else if(op==="day"){
    if(stage!=="date_calendar"||!validPickerDay(value)||
       value.slice(0,6)!==String(data.pickerMonth))throw Error("NOTICE_DATE_DAY");
    data={...data,pickerDay:value,pickerHour:null,noticePickerStage:"time_hour"};
   }else if(op==="hour"){
    if(stage!=="time_hour"||!/^(0\d|1\d|2[0-3])$/.test(value)||
       !validPickerDay(String(data.pickerDay||"")))throw Error("NOTICE_DATE_HOUR");
    data={...data,pickerHour:Number(value),noticePickerStage:"time_minute"};
   }else if(op==="minute"){
    if(stage!=="time_minute"||!/^[0-5]\d$/.test(value)||
       Number(value)%5!==0)throw Error("NOTICE_DATE_MINUTE");
    const when=selectedPickerTime(String(data.pickerDay||""),
     Number(data.pickerHour),Number(value));
    data={...data,
     [data.noticeDateField==="deadline"?"deadlineAt":"eventAt"]:when.toISOString(),
     noticePickerStage:null,noticeDateField:null};
   }else if(op==="manual"){
    data={...data,noticePickerStage:null,
     editField:data.noticeDateField==="deadline"?"deadline":"event"};
   }else throw Error("NOTICE_DATE_INVALID");
   const next=await updateDraft(ctx.from.id,"announcement",rev,
    op==="manual"?"awaiting_datetime":"preview",data);
   await ctx.answerCbQuery();
   if(op==="manual")
    await showPostScreen(ctx.telegram,ctx.from.id,next,
     "日時を YYYY/MM/DD HH:mm で入力してください。",
     Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",`post:announce:back:${next.revision}`)]]));
   else await announcementScreen(ctx.telegram,ctx.from.id,next);
  }catch{await ctx.answerCbQuery("日時を選び直してください");}
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
  const current=owner==="announcement"?await getDraft(ctx.from.id,"announcement"):await getWaitingDraft(ctx.from.id);
  if(!current||current.module!==owner||!["awaiting_text","awaiting_datetime","awaiting_room_url","awaiting_media"].includes(current.step))return next();
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
   if(current.module==="announcement"&&current.data.kind!=="recruitment"&&
      current.step==="awaiting_text"){
    const field=String(current.data.editField||"initial");
    let update:Record<string,unknown>;
    if(field==="initial"){
     const split=input.indexOf("\n");
     const title=split<0?input:input.slice(0,split);
     const body=split<0?"":input.slice(split+1);
     update=noticeEdit(noticeEdit(current.data,"title",title),"body",body);
    }else update=noticeEdit(current.data,field,input);
    const next=await updateDraft(ctx.from.id,"announcement",current.revision,"preview",
     {...update,editField:null});
    await announcementScreen(ctx.telegram,ctx.from.id,next);
    return;
   }
   if(current.module==="announcement"&&current.step==="awaiting_media"&&current.data.kind!=="recruitment"){
    if(input!=="なし")throw Error("画像・動画・ステッカーを送信してください。解除は「なし」です");
    const next=await updateDraft(ctx.from.id,"announcement",current.revision,"preview",
     noticeEdit(current.data,"media",input));
    await announcementScreen(ctx.telegram,ctx.from.id,next);
    return;
   }
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
    data={...current.data,
     [current.data.editField==="deadline"?"deadlineAt":"eventAt"]:date.toISOString(),
     editField:null,noticeDateField:null,noticePickerStage:null};
    if(current.module==="announcement"&&data.kind!=="recruitment")validateNotice(data,ctx.from.id);
    else validateAnnouncement({ownerId:ctx.from.id,
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
    const stage=String(current.data.linkStage||"button");
    if(stage==="content"||stage==="edittext"){
     if(input.length>(current.data.media?1024:3500))throw Error("LINK_BODY_INVALID");
     const editing=stage==="edittext";
     const updated=await updateDraft(ctx.from.id,"link",current.revision,
      editing?"preview":"awaiting_text",
      {...current.data,text:input,linkStage:editing?"ready":"button",
       linkEditorView:false});
     if(editing)await showLinkRichPreview(ctx.telegram,ctx.from.id,updated);
     else await render(updated,
      "🔗 ボタンを作成\n1行目：ボタンのタイトル\n2行目：ボタンにしたいURL",
      linkColorKeyboard(updated));
     return;
    }
    const button=parseLinkButtonPair(input);
     const style=String(current.data.linkSelectedStyle||"standard");
     if(!["standard","primary","success","danger"].includes(style))throw Error("LINK_STYLE_INVALID");
     if(style!=="standard")button.style=style as "primary"|"success"|"danger";
    const previous=Array.isArray(current.data.buttons)?
      current.data.buttons as LinkDraft["buttons"]:[];
    const replacing=current.data.linkEditMode==="replace"&&previous.length>0;
    const editIndex=Number(current.data.linkEditIndex);
    if(replacing&&(!Number.isSafeInteger(editIndex)||editIndex<0||
      editIndex>=previous.length))throw Error("LINK_EDIT_TARGET_INVALID");
    const existing:LinkDraft={
     text:String(current.data.text||""),
     buttons:previous,columns:[1,2,3].includes(Number(current.data.columns))?
      Number(current.data.columns) as 1|2|3:1,
     ...(current.data.media?{media:current.data.media as LinkDraft["media"]}:{})};
    const buttons=replacing?previous.map((item,i)=>i===editIndex?
      {...button,rowStart:item.rowStart}:item):
      previous.length===0?[{...button,rowStart:true}]:
      insertLinkButton(existing,button,
       current.data.linkPlacement==="beside"?
        {kind:"right",rowIndex:Number(current.data.linkTargetRow)}:
        {kind:"newRow"});
    const editorView=previous.length>0&&current.data.linkEditorView===true;
    const updated=await updateDraft(ctx.from.id,"link",current.revision,"preview",
      {...current.data,buttons,linkStage:"ready",linkEditMode:null,linkEditIndex:null,
       linkPlacement:null,linkTargetRow:null,linkSelectedStyle:"standard",linkEditorView:editorView,
       columns:existing.columns});
    if(editorView)await showLinkRichEditor(ctx.telegram,ctx.from.id,updated);
    else await showLinkRichPreview(ctx.telegram,ctx.from.id,updated);
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
    if(kind==="preview"&&!current.data.eventAt&&current.module!=="announcement"){
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
   if(e instanceof Error&&e.message==="POST_DRAFT_STALE"&&current.module!=="announcement")throw e;
   if(current.module==="link"){
    // Media-rich preview can fail AFTER the revision was persisted. Never render
    // an obsolete revision (its buttons cannot work); preserve the actual draft.
    const latest=await getDraft(ctx.from.id,"link");
    if(latest?.step==="preview"&&Array.isArray(latest.data.buttons)&&
       latest.data.buttons.length>0){
     console.warn("[LINK_PREVIEW_RENDER_FAILED] media="+
      (latest.data.media?"PRESENT":"ABSENT"));
     await render(latest,"⚠️ プレビューを表示できませんでした。下書きは保存されています。"+
      "\n素材を変更するか、プレビュー表示をもう一度お試しください。",
      Markup.inlineKeyboard([
       [Markup.button.callback("素材変更","post:link:editmedia:"+latest.revision),
        Markup.button.callback("再表示","post:link:back:"+latest.revision)],
       [Markup.button.callback("キャンセル","post:link:cancel:"+latest.revision)],
      ]));
     return;
    }
   }
   if(current.module==="announcement"&&current.data.kind!=="recruitment"){
    const latest=await getDraft(ctx.from.id,"announcement");
    if(latest)await showNoticeEditorError(ctx.telegram,ctx.from.id,latest,"入力内容を確認してください。",false);
    return;
   }
   const errorText=(e instanceof Error?e.message:"入力内容を確認してください。")+
     "\n内容を修正して、もう一度送信してください。";
   await render(current,errorText,current.module==="room"?
    roomStageKeyboard(current):current.module==="link"?
    Markup.inlineKeyboard([
     ...(Array.isArray(current.data.buttons)&&current.data.buttons.length?
       [[Markup.button.callback("↩ プレビューに戻る",
        "post:link:back:"+current.revision)]]:[]),
     [Markup.button.callback("キャンセル","post:link:cancel:"+current.revision)]
    ]):current.module==="announcement"&&current.data.kind!=="recruitment"?
    Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る","post:announce:back:"+current.revision)]]):undefined);
  }
 });
 // Uses the existing DM text-owner and Telegram file_id mechanism from profiles.
 const receiveLinkMedia=async(ctx:Context,next:()=>Promise<unknown>,kind:"photo"|"video"|"videoDocument")=>{
  if(ctx.chat?.type!=="private"||!ctx.from){await next();return;}
  if(await currentDmTextOwner(ctx.from.id)!=="link"){await next();return;}
  const original=await getWaitingDraft(ctx.from.id);
  if(!original||original.module!=="link"||
     !["content","button","editmedia"].includes(String(original.data.linkStage))){await next();return;}
  const msg=ctx.message;
  if(!msg){await next();return;}
  const file=kind==="photo"&&"photo" in msg?msg.photo.at(-1):
   kind==="video"&&"video" in msg?msg.video:
   kind==="videoDocument"&&"document" in msg&&msg.document.mime_type==="video/mp4"?
    msg.document:undefined;
  if(!file?.file_id){await next();return;}
  const caption="caption" in msg&&typeof msg.caption==="string"?msg.caption:"";
  const deleted=await removeUserWizardInput(ctx.telegram,ctx.chat.id,msg.message_id);
  const notice=deleted?"":"\n⚠️ 送信した素材メッセージを削除できません。手動で削除してください。";
  try{
   // Extra album messages may arrive after Step ② is displayed. Preserve
   // caption and append in the same draft rather than asking for a format menu.
   let updated:EditorDraft|undefined;
   for(let attempt=0;attempt<3;attempt++){
    const d=attempt===0?original:await getWaitingDraft(ctx.from.id);
    if(!d||d.module!=="link")throw Error("LINK_DRAFT_NOT_WAITING");
    const stage=String(d.data.linkStage||"content");
    if(!["content","button","editmedia"].includes(stage))throw Error("LINK_MEDIA_STAGE_CHANGED");
    const replacing=stage==="editmedia";
    const hasPrimary=Boolean(d.data.media);
    const oldText=String(d.data.text||"");
    // User-entered body and Telegram media caption are distinct fields.
    // Never silently reinterpret the first media caption as post body.
    const text=oldText;
    if(text.length>1024||caption.length>1024)throw Error("LINK_BODY_INVALID");
    const extras=Array.isArray(d.data.mediaExtras)?d.data.mediaExtras as LinkDraft["mediaExtras"]:[];
    const appended=stage==="button"&&hasPrimary;
    const newMedia={type:kind==="videoDocument"?"document":kind,fileId:file.file_id,...(caption?{caption}:{})};
    const media=appended?d.data.media:newMedia;
    const mediaExtras=appended?[...(extras||[]),newMedia]:extras||[];
    if(mediaExtras.length>=50)throw Error("LINK_MEDIA_ALBUM_LIMIT");
    const data={...d.data,text,media,mediaExtras,
     captionAbove:d.data.captionAbove===true,
     linkStage:replacing?"ready":"button",linkEditorView:false};
    try{
     updated=await updateDraft(ctx.from.id,"link",d.revision,
      replacing?"preview":"awaiting_text",data);
     break;
    }catch(error){
     if(!(error instanceof Error&&error.message==="POST_DRAFT_STALE")||attempt===2)throw error;
    }
   }
   if(!updated)throw Error("LINK_MEDIA_UPDATE_NOT_CONFIRMED");
   if(updated.step==="preview")await showLinkRichPreview(ctx.telegram,ctx.from.id,updated);
   else await showPostScreen(ctx.telegram,ctx.from.id,updated,
    "✅ "+(kind==="photo"?"画像":"動画")+"を受け取りました。"+notice+
    "\n\n次の2行をまとめて1回送信してください。\n1行目：ボタンのタイトル\n2行目：ボタンにしたいURL",
    linkColorKeyboard(updated));
  }catch(error){
   const reason=error instanceof Error?error.message:"登録失敗";
   await showPostScreen(ctx.telegram,ctx.from.id,original,
    "⚠️ 素材を登録できませんでした："+reason+notice,
    Markup.inlineKeyboard([[Markup.button.callback("キャンセル",
     "post:link:cancel:"+original.revision)]]));
  }
 };
 bot.on("photo",async(ctx,next)=>receiveLinkMedia(ctx,next,"photo"));
 bot.on("video",async(ctx,next)=>receiveLinkMedia(ctx,next,"video"));
 // Link-only transport diagnosis: a client may send an MP4 as a document.
 // Never log user identity, file IDs, captions, messages or chat contents.
 bot.on("document",async(ctx,next)=>{
  // Telegram clients may classify an uploaded MP4 as Document rather than Video.
  // Keep the same LinkDraft and Rich video block (no secondary storage or workflow).
  if(ctx.message.document.mime_type==="video/mp4")
   return receiveLinkMedia(ctx,next,"videoDocument");
  await next();
 });
 // Notice-only media, using Telegram file_id references.
 async function receiveNoticeMedia(telegram:Telegram,userId:number,chatId:number,
  messageId:number,kind:"photo"|"video"|"sticker",fileId:string,stickerInfo?:{thumbnailId?:string;animated?:boolean}):Promise<boolean>{
  const d=await getDraft(userId,"announcement");
  if(!d||!["awaiting_media","awaiting_text","preview"].includes(d.step)||d.data.kind==="recruitment"||
     await currentDmTextOwner(userId)!=="announcement")return false;
  if(d.step==="awaiting_text"&&d.data.editField&&d.data.editField!=="initial")return false;
  const media=noticeMedia(d.data);
  if(media.length>=5){
   await showPostScreen(telegram,userId,d,"画像・動画・ステッカーは合計最大5件です。送信した素材は未登録です。",
    Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",`post:announce:back:${d.revision}`)]]));
   return true;
  }
  let next:EditorDraft;
  try{
   next=await updateDraft(userId,"announcement",d.revision,d.step==="awaiting_text"?"awaiting_text":"preview",
    {...d.data,editField:d.step==="awaiting_text"?"initial":null,media:[...media,{kind,fileId,...stickerInfo}]});
  }catch(error){
   await showPostScreen(telegram,userId,d,"素材を登録できませんでした。送信した素材は削除していません。",
    Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",`post:announce:back:${d.revision}`)]]));
   return true;
  }
  try{
   if(!await announcementScreen(telegram,userId,next))return true;
  }catch{
   await showNoticeEditorError(telegram,userId,next,"素材は保存されましたがプレビュー未確認です。元の素材は削除していません。",false);
   return true;
  }
  const removed=await removeUserWizardInput(telegram,chatId,messageId);
  if(!removed)await showNoticeEditorError(telegram,userId,next,"素材は登録済みです。元の送信メッセージは削除できませんでした。");
  return true;
 }
 bot.on("photo",async(ctx,next)=>{
  if(ctx.chat.type!=="private")return next();
  const file=ctx.message.photo.at(-1);
  if(!file||!await receiveNoticeMedia(ctx.telegram,ctx.from.id,ctx.chat.id,
    ctx.message.message_id,"photo",file.file_id))return next();
 });
 bot.on("video",async(ctx,next)=>{
  if(ctx.chat.type!=="private")return next();
  if(!await receiveNoticeMedia(ctx.telegram,ctx.from.id,ctx.chat.id,
    ctx.message.message_id,"video",ctx.message.video.file_id))return next();
 });
 bot.on("sticker",async(ctx,next)=>{
  if(ctx.chat.type!=="private")return next();
  if(!await receiveNoticeMedia(ctx.telegram,ctx.from.id,ctx.chat.id,
    ctx.message.message_id,"sticker",ctx.message.sticker.file_id,
    ctx.message.sticker.is_animated||ctx.message.sticker.is_video?{animated:true,thumbnailId:ctx.message.sticker.thumbnail?.file_id}:undefined))return next();
 });
 // Telegram may classify a short silent MP4 as animation or a video/* document.
 // These fallbacks only accept the active private notice draft.
 bot.on("animation",async(ctx,next)=>{
  if(ctx.chat.type!=="private")return next();
  if(!await receiveNoticeMedia(ctx.telegram,ctx.from.id,ctx.chat.id,
    ctx.message.message_id,"video",ctx.message.animation.file_id))return next();
 });
 bot.on("document",async(ctx,next)=>{
  if(ctx.chat.type!=="private"||!ctx.message.document.mime_type?.startsWith("video/"))return next();
  if(!await receiveNoticeMedia(ctx.telegram,ctx.from.id,ctx.chat.id,
    ctx.message.message_id,"video",ctx.message.document.file_id))return next();
 });
 bot.action(/^post:link:selectcolor:(\d+):(standard|primary|success|danger)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const revision=Number(ctx.match[1]),color=ctx.match[2];
  const d=await getDraft(ctx.from.id,"link");
  if(!d||d.revision!==revision||d.step!=="awaiting_text"||d.data.linkStage!=="button"){
   await ctx.answerCbQuery("古い色選択です。");return;
  }
  const updated=await updateDraft(ctx.from.id,"link",revision,"awaiting_text",
   {...d.data,linkSelectedStyle:color});
  await ctx.answerCbQuery();
  await showPostScreen(ctx.telegram,ctx.from.id,updated,
   "🔗 ボタンを作成\n1行目：ボタンのタイトル\n2行目：ボタンにしたいURL",
   linkColorKeyboard(updated));
 });
 bot.action(/^post:link:restart:(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]),d=await getDraft(ctx.from.id,"link");
  if(!d||d.revision!==rev||d.step!=="awaiting_text"){
   await ctx.answerCbQuery("古い操作です。");return;
  }
  if(d.data.linkEditMode){
   const updated=await updateDraft(ctx.from.id,"link",rev,"preview",
    {...d.data,linkEditMode:null,linkEditIndex:null,linkSelectedStyle:"standard",
     linkEditorView:true,linkStage:"ready"});
   await ctx.answerCbQuery();await showLinkRichEditor(ctx.telegram,ctx.from.id,updated);
   return;
  }
  const updated=await updateDraft(ctx.from.id,"link",rev,"awaiting_text",
   {...d.data,text:"",media:null,captionAbove:false,buttons:[],columns:1,
    linkStage:"content",linkSelectedStyle:"standard",linkEditorView:false});
  await ctx.answerCbQuery();
  await showPostScreen(ctx.telegram,ctx.from.id,updated,
   "🔗ボタンを作成する上で一緒に投稿したテキスト、動画、画像、ステッカーなどを投稿してください。動画や画像に説明を補足した場合はキャプションにテキストを入力してください。",
   Markup.inlineKeyboard([[Markup.button.callback("キャンセル","post:link:cancel:"+rev)]]));
 });
 bot.action(/^post:link:receipt:(back|new|edit):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const action=ctx.match[1],revision=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"link");
  if(!d||d.revision!==revision||d.step!=="preview"||
     typeof d.data.shareCode!=="string"||d.data.linkEditingRegistered===true){
   await ctx.answerCbQuery("登録済み画面の状態が変わりました。");return;
  }
  if(action==="back"){
   await ctx.answerCbQuery();
   await editMessageToDmPostingMenu(ctx,ctx.from.id);
   return;
  }
  if(action==="new"){
   await ctx.answerCbQuery();
   await startLinkEditor(ctx.telegram,ctx.from.id,ctx.callbackQuery.message?.message_id);
   return;
  }
  const next=await updateDraft(ctx.from.id,"link",revision,"preview",
   {...d.data,linkEditingRegistered:true,linkEditorView:false});
  await ctx.answerCbQuery();
  await showLinkRichPreview(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^post:link:field:(\d+):(text|media|b\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const revision=Number(ctx.match[1]),field=ctx.match[2];
  const d=await getDraft(ctx.from.id,"link");
  if(!d||d.revision!==revision||d.step!=="preview"||d.data.linkEditorView!=="content"||
     (typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)){
   await ctx.answerCbQuery("古い編集操作です。");return;
  }
  const buttons=Array.isArray(d.data.buttons)?d.data.buttons:[];
  if(field==="text"&&!String(d.data.text||"").trim()||
     field==="media"&&!d.data.media||
     field.startsWith("b")&&(!Number.isInteger(Number(field.slice(1)))||
      Number(field.slice(1))>=buttons.length)){
   await ctx.answerCbQuery("編集項目を確認できません。");return;
  }
  const next=await updateDraft(ctx.from.id,"link",revision,"preview",
   {...d.data,linkSelectedField:field});
  await ctx.answerCbQuery();await showLinkRichEditor(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^post:link:(register|content|change|edittext|editmedia|mediareplace|mediadelete|captiontop|captionbottom|panel|add|beside|edit|cancel|back|destination):(\d+)(?::(\d+))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  let op=ctx.match[1];const rev=Number(ctx.match[2]);
  let targetRow=ctx.match[3]===undefined?null:Number(ctx.match[3]);
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

  if(op==="back"){
   const next=await updateDraft(ctx.from.id,"link",rev,"preview",
    {...d.data,linkEditorView:false,linkSelectedField:null,linkEditMode:null,
     linkEditIndex:null,linkStage:"ready",linkSelectedStyle:"standard"});
   await ctx.answerCbQuery();await showLinkRichPreview(ctx.telegram,ctx.from.id,next);return;
  }
  if(op==="content"||op==="panel"){
   if(d.step!=="preview"||(typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)){
    await ctx.answerCbQuery("登録済みの投稿は変更できません。");return;
   }
   const next=await updateDraft(ctx.from.id,"link",rev,"preview",
    {...d.data,linkEditorView:op==="content"?"content":true,linkSelectedField:null});
   await ctx.answerCbQuery();await showLinkRichEditor(ctx.telegram,ctx.from.id,next);return;
  }
  if(op==="change"){
   if(d.step!=="preview"||d.data.linkEditorView!=="content"){
    await ctx.answerCbQuery("内容の編集画面を開いてください。");return;
   }
   const field=String(d.data.linkSelectedField||"");
   if(field==="text")op="edittext";
   else if(field==="media")op="editmedia";
   else if(/^b\d+$/.test(field)){
    targetRow=Number(field.slice(1));
    if(!Array.isArray(d.data.buttons)||targetRow>=d.data.buttons.length){
     await ctx.answerCbQuery("編集項目が変更されています。");return;
    }
    op="edit";
   }else{await ctx.answerCbQuery("編集項目を選択してください。");return;}
  }
  if(op==="register"){
   if(d.step!=="preview"||Boolean(d.data.linkEditorView)){
    await ctx.answerCbQuery("先に投稿プレビューへ戻ってください。");return;
   }
   if((typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)){
    await ctx.answerCbQuery("登録済みです。");await showLinkRichPreview(ctx.telegram,ctx.from.id,d);return;
   }
   const me=await ctx.telegram.getMe();
   if(!("supports_inline_queries" in me)||me.supports_inline_queries!==true){
    await ctx.answerCbQuery("Botのインライン機能が未有効です。登録を行いません。",{show_alert:true});
    return;
   }
   try{
    const editingRegistered=typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered===true;
    const receipt=editingRegistered?
     await updateLinkShare(ctx.from.id,String(d.data.shareCode),d.data as LinkDraft):
     await registerLinkShare(ctx.from.id,rev,d.data as LinkDraft);
    const updated=await updateDraft(ctx.from.id,"link",rev,"preview",{
     ...d.data,shareCode:receipt.code,linkSourceId:receipt.sourceId,
     linkEditingRegistered:false,linkEditorView:false,
    });
    await ctx.answerCbQuery("登録しました");
    await showLinkRichPreview(ctx.telegram,ctx.from.id,updated);
   }catch(error){
    const reason=error instanceof Error?error.message:"unknown";
    console.error("[LINK_REGISTER_FAILED]",reason);
    await ctx.answerCbQuery("登録結果を確認できません。元の下書きは保持しています。",{show_alert:true});
   }
   return;
  }
  if(op==="edittext"||op==="editmedia"){
   if(d.step!=="preview"){await ctx.answerCbQuery("編集中です。");return;}
   if((typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)){
    await ctx.answerCbQuery("登録済みは変更できません。新規作成してください。",{show_alert:true});return;
   }
   if(op==="editmedia"){
    const updated=await updateDraft(ctx.from.id,"link",rev,"preview",
     {...d.data,linkMediaPanel:true,linkEditorView:false});
    await ctx.answerCbQuery();
    await showPostScreen(ctx.telegram,ctx.from.id,updated,
     "🖼 画像/動画編集\n現在："+(d.data.media?"登録済み":"未登録")+
     "\n画像・動画の差し替え、削除、コメント位置を選択できます。",
     linkMediaEditorKeyboard(updated));
    return;
   }
   const updated=await updateDraft(ctx.from.id,"link",rev,"awaiting_text",
    {...d.data,linkStage:"edittext",linkMediaPanel:false});
   await ctx.answerCbQuery();
   await showPostScreen(ctx.telegram,ctx.from.id,updated,
    "📝 テキスト編集\n現在の文章：\n"+String(d.data.text||"（なし）")+
    "\n\n新しい文章をDMで送信してください。",
    Markup.inlineKeyboard([[Markup.button.callback("↩ プレビューに戻る",
     "post:link:back:"+updated.revision)],
     [Markup.button.callback("キャンセル","post:link:cancel:"+updated.revision)]]));
   return;
  }
  if(op==="mediareplace"){
   if(d.step!=="preview"||(typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)||
     d.data.linkMediaPanel!==true){await ctx.answerCbQuery("編集画面を開いてください。");return;}
   const updated=await updateDraft(ctx.from.id,"link",rev,"awaiting_text",
    {...d.data,linkStage:"editmedia"});
   await ctx.answerCbQuery();
   await showPostScreen(ctx.telegram,ctx.from.id,updated,
    "新しい画像または動画をDMへ送信してください。未送信の間は既存の媒体を保持します。",
    Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",
     "post:link:back:"+updated.revision)],
     [Markup.button.callback("キャンセル","post:link:cancel:"+updated.revision)]]));
   return;
  }
  if(op==="mediadelete"){
   if(d.step!=="preview"||d.data.linkMediaPanel!==true||!d.data.media||
     (typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)){await ctx.answerCbQuery("削除できません。");return;}
   if(!String(d.data.text||"").trim()){
    await ctx.answerCbQuery("画像・動画のみの投稿です。先にテキストを追加してください。",{show_alert:true});return;
   }
   const {media:unused,...rest}=d.data;
   const updated=await updateDraft(ctx.from.id,"link",rev,"preview",
    {...rest,linkMediaPanel:false,captionAbove:false});
   await ctx.answerCbQuery("媒体を削除しました");
   await showLinkRichPreview(ctx.telegram,ctx.from.id,updated);
   return;
  }
  if(op==="captiontop"||op==="captionbottom"){
   if(d.step!=="preview"||d.data.linkMediaPanel!==true||
     !d.data.media||!String(d.data.text||"").trim()||
     (typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)){
    await ctx.answerCbQuery("コメント付き画像・動画の場合のみ変更できます。");return;
   }
   const updated=await updateDraft(ctx.from.id,"link",rev,"preview",
    {...d.data,captionAbove:op==="captiontop"});
   await ctx.answerCbQuery("表示位置を保存しました");
   await showPostScreen(ctx.telegram,ctx.from.id,updated,
    "🖼 画像/動画編集\nコメント位置："+(op==="captiontop"?"上":"下"),
    linkMediaEditorKeyboard(updated));
   return;
  }
  if(op==="add"||op==="beside"||op==="edit"){
   if(d.step!=="preview"||(op==="edit"?d.data.linkEditorView!=="content":d.data.linkEditorView!==true)||
     (typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)){
    await ctx.answerCbQuery("編集画面を開いてください。");return;
   }
   const rows=buttonGrid(d.data as LinkDraft);
   if(op==="edit"&&(targetRow===null||targetRow<0||
     targetRow>=(d.data.buttons as LinkDraft["buttons"]).length)){
    await ctx.answerCbQuery("編集するボタンを確認できません。");return;
   }
   if(op==="beside"&&(targetRow===null||!Number.isInteger(targetRow)||
     targetRow<0||targetRow>=rows.length)){
    await ctx.answerCbQuery("追加する列を確認できません。");return;
   }
   const next=await updateDraft(ctx.from.id,"link",rev,"awaiting_text",
    {...d.data,linkEditMode:op==="edit"?"replace":"add",
     linkPlacement:op==="beside"?"beside":"nextRow",
     linkTargetRow:op==="beside"?targetRow:null,
     linkEditIndex:op==="edit"?targetRow:null,linkStage:"button",
     linkSelectedStyle:op==="edit"?String((d.data.buttons as LinkDraft["buttons"])[targetRow!]!.style||"standard"):"standard"});
   await ctx.answerCbQuery();
   await showPostScreen(ctx.telegram,ctx.from.id,next,
    (op==="edit"?"📝 ボタンタイトル"+String(targetRow!+1)+"を編集":op==="beside"?
     "▶ 右横にボタンを追加":"▼ 次の段にボタンを追加")+
    "\n1行目：ボタンのタイトル\n2行目：ボタンにしたいURL",linkColorKeyboard(next));
   return;
  }
  if(op==="destination"){
   if(d.step!=="preview"||d.data.linkEditorView===true||
      !Array.isArray(d.data.buttons)||!d.data.buttons.length){
    await ctx.answerCbQuery("先にリンクボタンを追加してください。");return;
   }
   await ctx.answerCbQuery();
   await ctx.answerCbQuery("投稿先を選ぶ必要はありません。投稿コードを登録し、任意のチャットで使用してください。",{show_alert:true});
   return;
  }
  if(!Array.isArray(d.data.buttons)||!d.data.buttons.length){
   await ctx.answerCbQuery("先にリンクを入力してください。");return;
  }
  const editing=d.data.linkEditorView===true;
  const next=await updateDraft(ctx.from.id,"link",rev,"preview",
   {...d.data,linkEditorView:editing,linkEditMode:null,linkEditIndex:null,
    linkPlacement:null,linkTargetRow:null,linkStage:"ready"});
  await ctx.answerCbQuery();
  if(editing)await showLinkRichEditor(ctx.telegram,ctx.from.id,next);
  else await showLinkRichPreview(ctx.telegram,ctx.from.id,next);
 });

 bot.action(/^post:link:(delete):(\d+):(\d+)(?::([0-3]))?$/,async ctx=>{
  if(!privateDM(ctx))return;
  const op=ctx.match[1],revision=Number(ctx.match[2]);
  const index=Number(ctx.match[3]);
  const d=await getDraft(ctx.from.id,"link");
  if(!d||d.revision!==revision||d.step!=="preview"||d.data.linkEditorView!==true||
    (typeof d.data.shareCode==="string"&&d.data.linkEditingRegistered!==true)){
   await ctx.answerCbQuery("編集画面の状態が変わりました。");return;
  }
  const buttons=Array.isArray(d.data.buttons)?d.data.buttons as LinkDraft["buttons"]:[];
  if(!Number.isInteger(index)||index<0||index>=buttons.length){
   await ctx.answerCbQuery("ボタンが見つかりません。");return;
  }
  if(buttons.length===1){
   // Removing the last link returns to Step ②. Never leave an invalid empty preview.
   const next=await updateDraft(ctx.from.id,"link",revision,"awaiting_text",{
    ...d.data,buttons:[],linkStage:"button",linkEditorView:false,
    linkSelectedStyle:"standard",linkEditIndex:null,linkEditMode:null});
   await ctx.answerCbQuery("ボタンを削除しました。");
   await showPostScreen(ctx.telegram,ctx.from.id,next,
    "🔗 ボタンを作成\n1行目：ボタンのタイトル\n2行目：ボタンにしたいURL",
    linkColorKeyboard(next));
   return;
  }
  const rows=buttonGrid(d.data as LinkDraft);
  let seen=0;
  const remain=rows.map(row=>{
   const filtered=row.filter((_,i)=>seen+i!==index);
   seen+=row.length;
   return filtered;
  }).filter(row=>row.length);
  const nextButtons=remain.flatMap(row=>row.map((b,i)=>({...b,rowStart:i===0})));
  const updated=await updateDraft(ctx.from.id,"link",revision,"preview",
   {...d.data,buttons:nextButtons,linkEditIndex:null,linkEditMode:null,linkStage:"ready"});
  await ctx.answerCbQuery("削除しました");
  await showLinkRichEditor(ctx.telegram,ctx.from.id,updated);
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
    // The general notice uses its own validator (including media-only drafts).
    // Never let the legacy recruitment preview reject a valid notice selection.
    if(module==="announcement"&&(d.data.kind==="announcement"||d.data.kind==="preview")){
     validateNotice(d.data,ctx.from.id);
     const selected=await getVerifiedTopic(topicId,"announcement");
     const origin=await currentNoticeOrigin(ctx.from.id);
     if(origin&&(origin.chatId!==selected.chatId||origin.threadId!==selected.threadId)){
      await ctx.answerCbQuery("入口のトピックが確認できました。元のトピックへ投稿します。");
      await announcementScreen(ctx.telegram,ctx.from.id,d);return;
     }
     const next=await updateDraft(ctx.from.id,"announcement",rev,"preview",
      {...d.data,topicId,destinationLabel:BOARD_TITLES[selected.board]+" / "+selected.title,
       noticeDestinationExplicit:!origin});
     await ctx.answerCbQuery();
     await announcementScreen(ctx.telegram,ctx.from.id,next);
     return;
    }
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
  let noticePublishAttempt=false;
  let isRecruitment=false;
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
   let hostJoinUrl:string|null=null;
   let isScheduledRoom=false;
   let buttons:ReadonlyArray<ReadonlyArray<{text:string;url?:string;callback_data?:string;copy_text?:{text:string};style?:"primary"|"success"|"danger"}>>|undefined;
   let noticeAttachment:ReturnType<typeof noticeMedia>|undefined;
   let noticePreviewData:Record<string,unknown>|undefined;
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
    buttons=await makeProfileViewerButtons(ctx.from.id,revision,topicId,p.username);
   }else{
    const draft=await getDraft(ctx.from.id,module);
    if(!draft||draft.step!=="preview"||draft.revision!==revision)
     throw new Error("投稿下書きが変更されています。");
    if(module==="announcement"&&(draft.data.kind==="announcement"||draft.data.kind==="preview")){
     if(draft.data.topicId!==topicId)throw Error("ANNOUNCEMENT_DESTINATION_STALE");
     const origin=await currentNoticeOrigin(ctx.from.id);
     if(origin&&(origin.chatId!==destination.chatId||origin.threadId!==destination.threadId))
      throw Error("ANNOUNCEMENT_ORIGIN_CHANGED");
     if(!origin&&draft.data.noticeDestinationExplicit!==true)throw Error("ANNOUNCEMENT_ORIGIN_UNKNOWN");
     await assertFeatureReleased("announcement");
    }
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
     const isNotice=kind==="announcement"||kind==="preview";
     if(isNotice)validateNotice(draft.data,ctx.from.id);
     const value=isNotice?noticeText(draft.data):String(draft.data.text);
     const eventAt=draft.data.eventAt?new Date(String(draft.data.eventAt)):undefined;
     const purposeCodes=Array.isArray(draft.data.purposeCodes)?draft.data.purposeCodes as string[]:[];
     const placeCodes=Array.isArray(draft.data.placeCodes)?draft.data.placeCodes as string[]:[];
     const details=isNotice?{conditions:{
      participation:noticeJoin(draft.data),
      deadlineAt:draft.data.deadlineAt||null,
      linkLabel:draft.data.linkLabel||null,linkUrl:draft.data.linkUrl||null,
      media:noticeMedia(draft.data),
     }}:undefined;
     const ann=await createAnnouncement(ctx.from.id,revision,kind,value,eventAt,
      purposeCodes,placeCodes,undefined,details);
     sourceId=ann.sourceId;
     text=isNotice?noticeCard(draft.data,ctx.from.id):
      buildAnnouncementCard({ownerId:ctx.from.id,
       kind,text:value,eventAt,purposeCodes,placeCodes});
     if(isNotice){
      const actions:{text:string;url:string}[]=[];
      const join=noticeJoin(draft.data);
      const entry=await makeNoticeApplicationLink(ctx.from.id,Number(sourceId));
      if(join==="public")actions.push({text:"✅ 参加する",url:entry});
      else if(join==="approved_only")actions.push({text:"📝 応募する",url:entry});
      actions.push({text:"✉️ 質問する",url:entry});
      const link=noticeUrlButton(draft.data);
      if(link)actions.push(link);
      buttons=adaptiveChoiceRows(actions);
      noticeAttachment=noticeMedia(draft.data);
      noticePreviewData=draft.data;
     }else if(kind==="recruitment"){
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
    noticePublishAttempt=module==="announcement"&&!isRecruitment;
    result=await publishPost(ctx.telegram,{
     sourceType:module,sourceId,ownerId:ctx.from.id,revision,topicId,text,
     buttons,media:noticeAttachment,approved:true});
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
   }else if(module==="announcement"&&!isRecruitment){
    if(noticePreviewData)await clearNoticeStickerPreviews(ctx.telegram,ctx.from.id,noticePreviewData);
    await showPublishedNoticeOwner(ctx.telegram,ctx.from.id,Number(sourceId),
     "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
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
   if(module==="announcement"){
    const current=await getDraft(ctx.from.id,"announcement").catch(()=>null);
    if(current&&current.data.kind!=="recruitment"){
     const warning=uncertain||noticePublishAttempt?
      "投稿結果の確認が必要です。重複防止のため自動再送しません。":
      msg==="FEATURE_RELEASE_NOT_VERIFIED"?"告知の公開状態を確認できません。下書きは保持しています。":
      "投稿できませんでした。内容を保持しています。";
     await showNoticeEditorError(ctx.telegram,ctx.from.id,current,warning);return;
    }
    if(!isRecruitment){
     const screen="message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined;
     if(screen)try{await ctx.telegram.editMessageText(ctx.from.id,screen,undefined,
      "⚠️ 投稿結果を確認してください。重複防止のため自動再送しません。");}catch{}
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
