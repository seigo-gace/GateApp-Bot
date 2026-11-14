import {styledInlineButton} from "../services/inlineButtonStyle.js";
/** User-facing compact recruitment flow; no changes to generic announcements.
 * One free-text message -> owned draft -> field-specific edit -> reviewed post.
 * Native inline keyboard is a fallback for unverified rich inline editor support.
 */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {getProfile} from "../services/profileRepository.js";
import {PROFILE_POSITIONS,escapeProfileHtml,isProfilePosition} from "../services/profileCore.js";
import {PURPOSE_TAGS,normalizePlaceCodes} from "../services/announcementTags.js";
import {getDraft,beginDraft,updateDraft,bindDraftScreen,createAnnouncement,
 markPostSourcePublished,markDraftPublished,type EditorDraft} from "../services/publicPostRepository.js";
import {currentMenuOrigin} from "../services/menuOriginRepository.js";
import {currentTopicDmEntry,assertTopicDmEntryDestination,assertBoundTopicDmEntry,draftTopicEntryOrigin,verifiedOriginTopic} from "../services/topicDmEntry.js";
import {editMessageToDmPostingMenu} from "../services/dmPostingMenuRestore.js";
import {listVerifiedTopics,getVerifiedTopic} from "../services/postingDelivery.js";
import {BOARD_TITLES} from "../services/topicRouting.js";
import {ownerUsernameLink} from "../services/telegramUsernameLink.js";
import {publishPost,assertFeatureReleased} from "../services/publishService.js";
import {loadPublishedRecruitment,applyPublishedRecruitmentEdit,deletePublishedRecruitment,rememberPublishedRecruitmentDmScreen} from "../services/recruitmentPublishedEdit.js";
import {showWizardScreen,removeUserWizardInput} from "../services/dmWizardScreen.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {buildRecruitmentRichPreview} from "../services/recruitmentRichPreview.js";
import {recruitmentGroups,recruitmentAreaBlockOptions,recruitmentTopicsForAreaBlock,recruitmentTopicsForGroup} from "../services/recruitmentDestinationHierarchy.js";
import {recruitmentDecisionRow,recruitmentSelectionRows} from "../services/recruitmentButtonLayout.js";
import {recruitmentCompactSelectorRows} from "../services/recruitmentButtonLayout.js";
import {LIKE_CATEGORIES,likePageBounds,toggleLike,validLikeTags,type LikeTag} from "../services/profileLike.js";
import {roomRecruitmentCategoryRows,roomRecruitmentTagRows,roomRecruitmentTagHeading} from "../services/roomRecruitmentTagPanels.js";
import {parseRecruitmentMessage,changeRecruitmentField,
 renderRecruitmentPreview,validateRecruitmentReady,recruitmentTextPhase,type RecruitmentInput} from "../services/recruitmentCompose.js";

type EditField="title"|"nickname"|"stats"|"body";
const asInput=(d:EditorDraft)=>({
  ...d.data,
  purposeCodes:Array.isArray(d.data.purposeCodes)?d.data.purposeCodes:[],
  placeCodes:Array.isArray(d.data.placeCodes)?d.data.placeCodes:[],
  likeTags:validLikeTags(Array.isArray(d.data.likeTags)?d.data.likeTags as LikeTag[]:[]),
  loveTags:validLikeTags(Array.isArray(d.data.loveTags)?d.data.loveTags as LikeTag[]:[]),
  mode:d.data.mode==="linked"||d.data.recruitmentMode==="linked"?"linked":"manual",
}) as RecruitmentInput;
const active=(d:EditorDraft|null,rev:number,step?:string):d is EditorDraft=>
 !!d&&d.data.recruitmentFlow==="compact"&&d.revision===rev&&
 (!step||d.step===step);
async function show(telegram:Telegram,id:number,d:EditorDraft,text:string,keyboard?:any,html=false){
 const old=typeof d.data.screenMessageId==="number"?d.data.screenMessageId:undefined;
 const res=await showWizardScreen(telegram,id,old,text,html?{...keyboard,parse_mode:"HTML"}:keyboard);
 if(res.messageId!==old)await bindDraftScreen(id,d.module,d.revision,res.messageId);
}
const b=styledInlineButton;
function decisionRow(revision:number){
 return recruitmentDecisionRow(revision).map(item=>b(item.text,item.callback_data,"style" in item?item.style:undefined));
}
/** Shared input/edit button rows. ROOM changes only Purpose/Place labels and
 * binds its own callback namespace; Recruitment's original layout remains canonical.
 */
export function recruitmentEditorFieldRows(
 mode:"manual"|"linked",revision:number,
 callbacks:{edit:(field:"title"|"nickname"|"stats"|"body")=>string;
  position:()=>string;like:()=>string;love:()=>string;purpose:()=>string;place:()=>string},
 selected:{position:boolean;like:boolean;love:boolean;purpose:boolean;place:boolean}
):ReturnType<typeof Markup.button.callback>[][]{
 const edit=(label:string,field:"title"|"nickname"|"stats"|"body")=>
  b(label,callbacks.edit(field),"primary");
 const fields=mode==="manual"?[
  [edit("📝 タイトル","title"),edit("📝 ニックネーム","nickname")],
  [edit("📝 身長/体重/年齢","stats"),edit("📝 募集内容","body")],
 ]:[[edit("📝 タイトル","title"),edit("📝 募集内容","body")]];
 return [...fields,...recruitmentCompactSelectorRows(mode,selected.position,selected,{
  position:callbacks.position(),like:callbacks.like(),love:callbacks.love(),
  purpose:callbacks.purpose(),place:callbacks.place(),
 })];
}
function recruitmentSelectorRows(d:EditorDraft){
 const r=d.revision,input=asInput(d);
 return recruitmentCompactSelectorRows(input.mode,!!input.position,{
  like:input.likeTags!.length>0,love:input.loveTags!.length>0,
  purpose:input.purposeCodes.length>0,place:input.placeCodes.length>0,
 },{
  position:`recruit:panel:${r}:position`,
  like:`recruit:panel:${r}:like`,
  love:`recruit:panel:${r}:love`,
  purpose:`recruit:panel:${r}:purpose`,
  place:`recruit:panel:${r}:place`,
 });
}
function keyboard(d:EditorDraft){
 const rev=d.revision;
 const data=asInput(d);
 const rows:any[][]=recruitmentEditorFieldRows(data.mode,rev,{
  edit:field=>`recruit:edit:${rev}:${field}`,
  position:()=>`recruit:panel:${rev}:position`,
  like:()=>`recruit:panel:${rev}:like`,
  love:()=>`recruit:panel:${rev}:love`,
  purpose:()=>`recruit:panel:${rev}:purpose`,
  place:()=>`recruit:panel:${rev}:place`,
 },{
  position:!!data.position,like:!!data.likeTags?.length,love:!!data.loveTags?.length,
  purpose:data.purposeCodes.length>0,place:data.placeCodes.length>0,
 });
 const finalRow=d.data.publishedSourceId?
  [b("✅ 変更を反映",`recruit:post:${rev}`,"success"),b("キャンセル",`recruit:cancel:${rev}`,"danger")]:decisionRow(rev);
 rows.push([finalRow[0]!,b("🪪 プロフ登録","pc:from:recruit","primary"),finalRow[1]!]);
 return Markup.inlineKeyboard(rows);
}
function initialKeyboard(d:EditorDraft){
 const finalRow=decisionRow(d.revision);
 return Markup.inlineKeyboard([...recruitmentSelectorRows(d),
  [finalRow[0]!,b("🪪 プロフ登録","pc:from:recruit","primary"),finalRow[1]!]]);
}
export function inputInstructions(linked:boolean){
 return linked?
  "📢 相手募集を作成\n保存済みプロフィールと連動します。タイトルを入力し、必要なら募集内容も同じメッセージで送信してください。\n\n"+
   "1行目：タイトル\n2行目以降：募集内容（任意・改行自由）\n\n例：\n今夜遊べる人募集\n会える方を探しています。\n時間は相談で決めたいです。":
  "📢 相手募集を作成\nプロフィール未登録のため、この募集だけに使う情報を1通で入力してください。"+
  "\n\n1行目：タイトル\n2行目：ニックネーム\n3行目：身長 体重 年齢"+
  "\n4行目以降：募集内容（任意・改行自由）\n\n例：\n今夜遊べる人募集\nゼロ\n175 80 40\n会える方を探しています。\n時間は相談で決めたいです。";
}
async function showPreview(telegram:Telegram,id:number,d:EditorDraft,warning=""){
 const input=asInput(d);
 const profile=input.mode==="linked"?await getProfile(id):null;
 const destinations=await listVerifiedTopics("announcement");
 // A published edit always reflects the actual delivery receipt; a fresh draft
 // reflects only the explicitly selected verified topic, never an old DM entry.
 const publishedId=Number(d.data.publishedSourceId);
 const published=Number.isSafeInteger(publishedId)&&publishedId>0?
  await loadPublishedRecruitment(id,publishedId):null;
 const selected=published?
  destinations.find(t=>t.id===published.topicId&&t.chatId===published.chatId&&t.threadId===published.threadId):
  destinations.find(t=>t.id===Number(d.data.selectedTopicId));
 if(published&&!selected)throw Error("RECRUITMENT_PUBLICATION_TOPIC_NOT_VERIFIED");
 const rawDestination=selected?
  BOARD_TITLES[selected.board]+"\n"+selected.title+" / 投稿ID："+(published?published.sourceId:"未発行"):
  "投稿先グループ：未選択\n投稿先を選んでから公開してください。";
 const fullKeyboard=keyboard(d);
 // The Rich editor has buttons beside the field text. Keep only the shared
 // selectors/publish/back buttons below it; plain mode uses all edit buttons.
 const actionRows=fullKeyboard.reply_markup.inline_keyboard.filter(row=>
  !row.some(button=>"callback_data" in button&&
    String(button.callback_data).startsWith("recruit:edit:")));
 try{
  const api=telegram as unknown as {callApi:(method:string,payload:Record<string,unknown>)=>Promise<any>};
  const old=typeof d.data.screenMessageId==="number"?d.data.screenMessageId:undefined;
  const rich=buildRecruitmentRichPreview(input,d.revision,rawDestination,warning,profile,!!d.data.publishedSourceId);
  const payload={chat_id:id,rich_message:rich,
    reply_markup:{inline_keyboard:actionRows}};
  if(old){
   try{
    await api.callApi("editMessageText",{...payload,message_id:old});
    return;
   }catch(e){
    if(e instanceof Error&&/message is not modified/i.test(e.message))return;
    // On an unsupported edit, the regular-mode fallback retains all buttons.
   }
  }else{
   const sent=await api.callApi("sendRichMessage",payload);
   if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)
    throw Error("RICH_MESSAGE_ID_INVALID");
   await bindDraftScreen(id,"announcement",d.revision,sent.message_id);
   return;
  }
 }catch{
  // Telegram API/SDK or device support cannot be assumed in advance.
 }
 await show(telegram,id,d,rawDestination.split("\n").map(escapeProfileHtml).join("\n")+"\n"+
  renderRecruitmentPreview(input,profile)+
  "\n\n"+(d.data.publishedSourceId?"📢 公開済み募集を編集中":"📢 相手募集（未投稿）")+
  "\n📝各項目を変更しても他の入力は保持します。"+
  (warning?"\n"+escapeProfileHtml(warning):""),fullKeyboard,true);
}
export async function showRecruitmentDestinationStep(telegram:Telegram,id:number,d:EditorDraft,
 stage:"groups"|"blocks"|"topics",board?:"area_bbs"|"gay_board"|"video_chat",index=0,page=0,namespace:"recruit"|"room"="recruit"){
 const all=await listVerifiedTopics("announcement");
 const rev=d.revision;
 let heading="📍 投稿先グループを選択してください";
 let items:{text:string;callback:string}[]=[];
 if(stage==="groups"){
  items=recruitmentGroups(all).map(x=>({text:x.label,callback:`${namespace}:destgroup:${rev}:${x.board}`}));
 }else if(stage==="blocks"){
  heading="📍 エリアブロックを選択してください";
  items=recruitmentAreaBlockOptions(all).map(x=>({
   text:x.label,callback:`${namespace}:destblock:${rev}:${x.index}`}));
 }else{
  const matches=board==="area_bbs"?
   recruitmentTopicsForAreaBlock(all,index):
   recruitmentTopicsForGroup(all,board==="gay_board"?"gay_board":"video_chat");
  if(page<0||page*10>=matches.length)throw Error("RECRUITMENT_DESTINATION_PAGE_INVALID");
  heading="📍 投稿するトピックを選択してください";
  items=matches.slice(page*10,(page+1)*10).map(t=>({
   text:t.title,callback:`${namespace}:destchoose:${rev}:${t.id}`}));
  if(page>0)items.push({text:"◀ 前へ",callback:`${namespace}:destpage:${rev}:${board}:${index}:${page-1}`});
  if((page+1)*10<matches.length)items.push({text:"次へ ▶",callback:`${namespace}:destpage:${rev}:${board}:${index}:${page+1}`});
 }
 if(!items.length)throw Error("RECRUITMENT_DESTINATIONS_NOT_VERIFIED");
 if(stage==="blocks")items.push({text:"◀ グループ選択",callback:`${namespace}:destback:${rev}:groups`});
 if(stage==="topics")items.push({text:board==="area_bbs"?"◀ エリアブロック":"◀ グループ選択",
  callback:`${namespace}:destback:${rev}:${board==="area_bbs"?"blocks":"groups"}`});
 await show(telegram,id,d,heading,Markup.inlineKeyboard(items.map(x=>[b(x.text,x.callback)])));
}
/** The authenticated Topic doorway is the normal destination.
 * The hierarchical chooser is only a fallback for an invalid or changed origin.
 */
async function currentRecruitmentMenuTopic(userId:number){
 const pinned=await currentTopicDmEntry(userId);
 const origin=pinned?null:await currentMenuOrigin(userId);
 const entry=pinned??origin;
 const topics=await listVerifiedTopics("announcement");
 return verifiedOriginTopic(topics,entry);
}
export async function startCompactRecruitmentEditor(telegram:Telegram,userId:number,menuMessageId?:number){
 let previous=await getDraft(userId,"announcement");
 if(previous?.data.recruitmentFlow==="compact"&&!previous.data.publishedSourceId){
  // Keep the authenticated Topic as the normal destination, even for an
  // existing private draft. Never overwrite an explicit fallback selection.
  const incoming=await currentRecruitmentMenuTopic(userId);
  const newMenu=Number.isSafeInteger(menuMessageId)&&Number(menuMessageId)>0&&
   previous.data.screenMessageId!==Number(menuMessageId);
  if(incoming&&(newMenu||previous.data.destinationExplicit!==true)&&
     (newMenu||Number(previous.data.selectedTopicId)!==incoming.id)){
   previous=await updateDraft(userId,"announcement",previous.revision,previous.step,{
    ...previous.data,selectedTopicId:incoming.id,destinationExplicit:false,
    entryChatId:incoming.chatId,entryThreadId:incoming.threadId,
   });
  }
  // Starting a new recruitment from the posting menu must not reopen an old
  // published-post edit draft. Published edits are entered only from the
  // existing publication management callback.
  // Reuse the tapped menu screen rather than silently editing an old DM screen.
  // Preserve the entire draft and its previously selected fields.
  if(Number.isSafeInteger(menuMessageId)&&Number(menuMessageId)>0&&
     previous.data.screenMessageId!==Number(menuMessageId)){
   await bindDraftScreen(userId,"announcement",previous.revision,Number(menuMessageId));
   previous=await getDraft(userId,"announcement");
   if(!previous||previous.data.recruitmentFlow!=="compact")
    throw Error("RECRUITMENT_DRAFT_SCREEN_REBIND_FAILED");
  }
  // Older stored compact drafts can lack the current preview fields or tag
  // arrays. Never discard their other values or reset the user's profile.
  // A missing text body means the existing input screen, not a broken preview.
  if(["preview","awaiting_tags","awaiting_recruitment_edit","awaiting_text"].includes(previous.step)){
   const recovered:Record<string,unknown>={
    ...previous.data,
    mode:previous.data.mode==="linked"||previous.data.recruitmentMode==="linked"?"linked":"manual",
    purposeCodes:Array.isArray(previous.data.purposeCodes)?previous.data.purposeCodes:[],
    placeCodes:Array.isArray(previous.data.placeCodes)?previous.data.placeCodes:[],
    likeTags:validLikeTags(Array.isArray(previous.data.likeTags)?previous.data.likeTags as LikeTag[]:[]),
    loveTags:validLikeTags(Array.isArray(previous.data.loveTags)?previous.data.loveTags as LikeTag[]:[]),
    // Older drafts may omit body entirely; it is an optional field.
    body:typeof previous.data.body==="string"?previous.data.body:"",
   };
   const missingText=["preview","awaiting_tags","awaiting_recruitment_edit"].includes(previous.step)&&
    (typeof recovered.title!=="string"||!recovered.title.trim());
   const changed=missingText||recovered.body!==previous.data.body||
    recovered.mode!==previous.data.mode||
    recovered.purposeCodes!==previous.data.purposeCodes||
    recovered.placeCodes!==previous.data.placeCodes||
    !Array.isArray(previous.data.likeTags)||!Array.isArray(previous.data.loveTags);
   if(changed){
    previous=await updateDraft(userId,"announcement",previous.revision,
     missingText?"awaiting_text":previous.step,recovered);
   }
   if(missingText){
    await show(telegram,userId,previous,inputInstructions(recovered.mode==="linked"),
     initialKeyboard(previous));
    return;
   }
  }
  if(previous.step==="preview"){
   await showPreview(telegram,userId,previous);return;
  }
  if(["awaiting_tags","awaiting_recruitment_edit"].includes(previous.step)){
   const returnStep=previous.step==="awaiting_tags"&&
     previous.data.recruitPanelReturnStep==="awaiting_text"?"awaiting_text":"preview";
   const restored=await updateDraft(userId,"announcement",previous.revision,returnStep,
    {...previous.data,recruitPanel:null,recruitPanelReturnStep:null,editField:null});
   if(returnStep==="awaiting_text"){
    await show(telegram,userId,restored,inputInstructions(restored.data.mode==="linked"),initialKeyboard(restored));
   }else{
    await showPreview(telegram,userId,restored);
   }
   return;
  }
  if(previous.step==="awaiting_text"){
   // Re-selecting this editor must make its input draft the most recently active
   // owner; otherwise an older screen can lose its next text to another flow.
   const resumed=await updateDraft(userId,"announcement",previous.revision,"awaiting_text",previous.data);
   await show(telegram,userId,resumed,inputInstructions(resumed.data.mode==="linked"),
    initialKeyboard(resumed));return;
  }
 }
 const profile=await getProfile(userId);
 const pinned=await currentTopicDmEntry(userId);
 const origin=pinned?null:await currentMenuOrigin(userId);
 const entry=pinned??origin;
 const defaultTopic=await currentRecruitmentMenuTopic(userId);
 const linked=!!profile&&isProfilePosition(profile.position??"");
 const d=await beginDraft(userId,"announcement","awaiting_text",{
  kind:"recruitment",recruitmentFlow:"compact",
  recruitmentMode:linked?"linked":"manual",
  mode:linked?"linked":"manual",profileRevision:linked?profile!.revision:null,
  purposeCodes:[],placeCodes:[],
  likeTags:linked?validLikeTags(profile!.likeTags??[]):[],
  loveTags:linked?validLikeTags(profile!.loveTags??[]):[],
  ...(entry?{entryChatId:entry.chatId,entryThreadId:entry.threadId}:{}),
  ...(defaultTopic?{selectedTopicId:defaultTopic.id,destinationExplicit:false}:{}),
 });
 if(Number.isSafeInteger(menuMessageId)&&Number(menuMessageId)>0){
  await bindDraftScreen(userId,"announcement",d.revision,Number(menuMessageId));
  d.data.screenMessageId=Number(menuMessageId);
 }
 await show(telegram,userId,d,inputInstructions(linked),
  initialKeyboard(d));
}
async function publishRecruitment(
 telegram:Telegram,owner:number,d:EditorDraft,topicId:number,explicitTopicChoice=false
):Promise<{chatId:number;threadId:number;messageId:number;sourceId:number}>{
 const data=asInput(d);
 const profile=data.mode==="linked"?await getProfile(owner):null;
 validateRecruitmentReady(data,profile);
 if(data.mode==="linked"&&profile?.revision!==d.data.profileRevision)
  throw new Error("プロフィールが更新されています。更新後の内容を再確認してください。");
 const topic=await getVerifiedTopic(topicId,"announcement");
 const pinned=await currentTopicDmEntry(owner);
 const origin=pinned?null:await currentMenuOrigin(owner);
 const bound=draftTopicEntryOrigin(d.data.entryChatId,d.data.entryThreadId);
 // Explicit choice of an already verified destination supersedes stale origin.
 if(!explicitTopicChoice){
  assertBoundTopicDmEntry(bound,pinned??origin,{chatId:topic.chatId,threadId:topic.threadId});
  await assertTopicDmEntryDestination(owner,topic.chatId,topic.threadId);
 }
 // Fail before writing an announcement or application token when public release is closed.
 await assertFeatureReleased("announcement");
 // The posted message is rendered exclusively by the Bot, never forwarded.
 const text=renderRecruitmentPreview(data,profile);
 const snapshot=profile?{
  nickname:profile.nickname,heightCm:profile.heightCm,weightKg:profile.weightKg,
  age:profile.age,position:profile.position,
 }:null;
 const conditions={
  inputMode:data.mode,title:data.title,
  likeTags:validLikeTags(data.likeTags??[]),loveTags:validLikeTags(data.loveTags??[]),
  ...(data.mode==="manual"?{
   nickname:data.nickname,heightCm:data.heightCm,weightKg:data.weightKg,
   age:data.age,position:data.position,
  }:{}),
 };
 // No default recruitment deadline or application approval flow was authorized.
 const usernameLink=await ownerUsernameLink(telegram,owner);
 const ann=await createAnnouncement(owner,d.revision,"recruitment",data.body,
  undefined,data.purposeCodes,data.placeCodes,undefined,
  {profileSnapshot:snapshot,conditions});
 const sent=await publishPost(telegram,{
  sourceType:"announcement",destinationPurpose:"announcement",sourceId:ann.sourceId,
  ownerId:owner,revision:d.revision,topicId,text,approved:true,
  buttons:[[{text:"🔗 募集者へ連絡",url:usernameLink}]],
 });
 await markPostSourcePublished(owner,"announcement",ann.sourceId);
 if(Number.isSafeInteger(d.data.screenMessageId)&&Number(d.data.screenMessageId)>0)
  await rememberPublishedRecruitmentDmScreen(owner,Number(ann.sourceId),Number(d.data.screenMessageId));
 await markDraftPublished(owner,"announcement",d.revision);
 return {...sent,sourceId:Number(ann.sourceId)};
}
/** Exact private-supergroup post link; no guess from a topic id. */
function postedMessageUrl(chatId:number,messageId:number):string{
 const raw=String(chatId);
 if(!/^-100[1-9]\d*$/.test(raw)||!Number.isSafeInteger(messageId)||messageId<=0)
  throw Error("POSTED_MESSAGE_LINK_INVALID");
 return "https://t.me/c/"+raw.slice(4)+"/"+messageId;
}
export async function showRecruitmentPublished(
 ctx:{editMessageText:(text:string,extra?:any)=>Promise<unknown>;from?:{id:number}},
 sent:{chatId:number;threadId:number;messageId:number;sourceId:number},
):Promise<void>{
 if(!ctx.from?.id)throw Error("RECRUITMENT_DM_OWNER_REQUIRED");
 const record=await loadPublishedRecruitment(ctx.from.id,sent.sourceId);
 if(record.chatId!==sent.chatId||record.threadId!==sent.threadId||
    record.messageId!==sent.messageId)throw Error("RECRUITMENT_DELIVERY_MISMATCH");
 const topics=await listVerifiedTopics("announcement");
 const topic=topics.find(t=>t.chatId===sent.chatId&&t.threadId===sent.threadId);
 if(!topic)throw Error("RECRUITMENT_TOPIC_NOT_VERIFIED");
 const profile=record.input.mode==="linked"?await getProfile(ctx.from.id):null;
 const details=renderRecruitmentPreview(record.input,profile);
 const screen=escapeProfileHtml(BOARD_TITLES[topic.board])+
  "\n"+escapeProfileHtml(topic.title)+" / 投稿ID："+sent.sourceId+
  "\n"+details+"\n\n✅ 募集を投稿しました。";
 await ctx.editMessageText(screen,{
  parse_mode:"HTML",
  ...Markup.inlineKeyboard([
   [Markup.button.callback("✏️ 編集","recruit:published:edit:"+sent.sourceId),
    Markup.button.callback("🗑 削除","recruit:published:delete:"+sent.sourceId)],
   [Markup.button.url("📍 投稿先を開く",postedMessageUrl(sent.chatId,sent.messageId))]
  ])
 });
}
async function checkLinkedProfileChanged(telegram:Telegram,id:number,d:EditorDraft):Promise<boolean>{
 if(asInput(d).mode!=="linked")return false;
 const latest=await getProfile(id);
 if(!latest||!isProfilePosition(latest.position??""))
  throw Error("保存済みプロフィールが見つかりません。");
 if(latest.revision===d.data.profileRevision)return false;
 const revised=await updateDraft(id,"announcement",d.revision,"preview",{
  ...d.data,profileRevision:latest.revision});
 await showPreview(telegram,id,revised,
  "プロフィールが更新されたため、公開前プレビューを新しい内容に更新しました。内容を確認してからもう一度［投稿］を押してください。");
 return true;
}
export function registerCompactRecruitmentHandlers(bot:Telegraf){
 bot.action(/^recruit:destback:(\d+):(groups|blocks)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]))){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,
   ctx.match[2] as "groups"|"blocks",ctx.match[2]==="blocks"?"area_bbs":undefined);
 });

 bot.action(/^recruit:destgroup:(\d+):(area_bbs|gay_board|video_chat)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]))){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  const board=ctx.match[2] as "area_bbs"|"gay_board"|"video_chat";
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,
   board==="area_bbs"?"blocks":"topics",board);
 });
 bot.action(/^recruit:destblock:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]))){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,"topics","area_bbs",Number(ctx.match[2]));
 });
 bot.action(/^recruit:destpage:(\d+):(area_bbs|gay_board|video_chat):(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]))){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,"topics",
   ctx.match[2] as "area_bbs"|"gay_board"|"video_chat",Number(ctx.match[3]),Number(ctx.match[4]));
 });
 bot.action(/^recruit:destchoose:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]))){await ctx.answerCbQuery("古い操作です");return;}
  if(d.data.publishedSourceId){
   await ctx.answerCbQuery("公開済み募集の投稿先は変更できません。新規投稿から選択してください",{show_alert:true});
   return;
  }
  const target=await getVerifiedTopic(Number(ctx.match[2]),"announcement");
  const next=await updateDraft(ctx.from.id,"announcement",d.revision,d.step,{
   ...d.data,selectedTopicId:target.id,destinationExplicit:true,
   entryChatId:target.chatId,entryThreadId:target.threadId,
   destinationLabel:BOARD_TITLES[target.board]+" / "+target.title});
  await ctx.answerCbQuery("投稿先を設定しました");
  if(next.step==="awaiting_text"){
   await show(ctx.telegram,ctx.from.id,next,
    "📍 投稿先："+escapeProfileHtml(String(next.data.destinationLabel))+"\n\n"+
    escapeProfileHtml(inputInstructions(next.data.mode==="linked")),
    initialKeyboard(next),true);
  }else await showPreview(ctx.telegram,ctx.from.id,next);
 });

 bot.command("recruit",async ctx=>{
  if(ctx.chat.type!=="private")return;
  await startCompactRecruitmentEditor(ctx.telegram,ctx.from.id);
 });
 // Selection from the existing announce/preview/recruitment entry is routed
 // to this editor without changing the other two types.
 bot.action(/^post:kind:(\d+):recruitment$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.revision!==Number(ctx.match[1])||d.step!=="awaiting_kind"){
   await ctx.answerCbQuery("古い操作です");return;
  }
  await ctx.answerCbQuery();
  await startCompactRecruitmentEditor(ctx.telegram,ctx.from.id);
 });
 bot.on("text",async(ctx,next)=>{
  if(ctx.chat.type!=="private"||ctx.message.text.startsWith("/"))return next();
  // The same active-owner arbitration used by the other DM wizards.
  if(await currentDmTextOwner(ctx.from.id)!=="announcement")return next();
  const d=await getDraft(ctx.from.id,"announcement");
  const phase=d?.data.recruitmentFlow==="compact"?
   recruitmentTextPhase(d.step,d.data.recruitPanelReturnStep):null;
  if(!d||!phase)return next();
  const cleared=await removeUserWizardInput(ctx.telegram,ctx.chat.id,ctx.message.message_id);
  const warning=cleared?"":"⚠️ 入力メッセージを削除できませんでした。手動で削除してください。";
  try{
   if(phase==="initial"){
    const input=parseRecruitmentMessage(ctx.message.text,d.data.mode==="linked");
    const updated=await updateDraft(ctx.from.id,"announcement",d.revision,"preview",{
     ...d.data,...input,
     purposeCodes:d.data.purposeCodes??[],placeCodes:d.data.placeCodes??[],
     likeTags:validLikeTags(Array.isArray(d.data.likeTags)?d.data.likeTags as LikeTag[]:[]),
     loveTags:validLikeTags(Array.isArray(d.data.loveTags)?d.data.loveTags as LikeTag[]:[]),
     position:input.mode==="manual"?(d.data.position??input.position):input.position,
     editField:null,recruitPanel:null,recruitPanelReturnStep:null});
    await showPreview(ctx.telegram,ctx.from.id,updated,warning);
   }else{
    const field=d.data.editField as EditField;
    if(!["title","nickname","stats","body"].includes(field))throw Error("EDIT_FIELD_INVALID");
    const changed=changeRecruitmentField(asInput(d),field,ctx.message.text);
    const updated=await updateDraft(ctx.from.id,"announcement",d.revision,"preview",{
     ...d.data,...changed,editField:null});
    await showPreview(ctx.telegram,ctx.from.id,updated,warning);
   }
  }catch(e){
   const message="入力内容を確認してください。\n"+
    escapeProfileHtml(e instanceof Error?e.message:"入力エラー")+
    "\n再入力してください。"+(warning?"\n"+escapeProfileHtml(warning):"");
   const buttons=phase==="edit"?
    Markup.inlineKeyboard([[b("↩ 編集をやめる",`recruit:editcancel:${d.revision}`)]]):
    initialKeyboard(d);
   await show(ctx.telegram,ctx.from.id,d,message,buttons,true);
  }
 });
 bot.action(/^recruit:edit:(\d+):(title|nickname|stats|body)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  const rev=Number(ctx.match[1]),field=ctx.match[2] as EditField;
  if(!active(d,rev,"preview")||
    (asInput(d).mode==="linked"&&["nickname","stats"].includes(field))){
   await ctx.answerCbQuery("古い編集ボタンです");return;
  }
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_recruitment_edit",{
   ...d.data,editField:field});
  await ctx.answerCbQuery();
  await show(ctx.telegram,ctx.from.id,next,
   "📝 "+({title:"タイトル",nickname:"ニックネーム",stats:"身長 体重 年齢",body:"募集内容"}[field])+
   "だけを送信してください。ほかの項目は変更しません。"+
   (field==="body"?"\n複数行の改行もそのまま保持します。":""),
   Markup.inlineKeyboard([[b("↩ 編集をやめる",`recruit:editcancel:${next.revision}`)]]));
 });
 bot.action(/^recruit:editcancel:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]),"awaiting_recruitment_edit")){
   await ctx.answerCbQuery("古い操作です");return;
  }
  const next=await updateDraft(ctx.from.id,"announcement",d.revision,"preview",
   {...d.data,editField:null});
  await ctx.answerCbQuery();await showPreview(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^recruit:panel:(\d+):(position|purpose|place|like|love)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  const rev=Number(ctx.match[1]),panel=ctx.match[2];
  if(!active(d,rev)||!["preview","awaiting_text","awaiting_tags"].includes(d.step)||
    (panel==="position"&&asInput(d).mode!=="manual")){
   await ctx.answerCbQuery("古い操作です");return;
  }
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",{
   ...d.data,recruitPanel:panel,recruitTagCategory:null,recruitTagPage:0,
   recruitPanelReturnStep:d.step==="awaiting_tags"?d.data.recruitPanelReturnStep:d.step});
  await ctx.answerCbQuery();
  await renderPanel(ctx.telegram,ctx.from.id,next);
 });
 async function leaveRecruitPanel(telegram:Telegram,id:number,d:EditorDraft){
  const step=d.data.recruitPanelReturnStep==="awaiting_text"?"awaiting_text":"preview";
  const updated=await updateDraft(id,"announcement",d.revision,step,{
   ...d.data,recruitPanel:null,recruitTagCategory:null,recruitTagPage:0,recruitPanelReturnStep:null});
  if(step==="awaiting_text")await show(telegram,id,updated,inputInstructions(asInput(updated).mode==="linked"),initialKeyboard(updated));
  else await showPreview(telegram,id,updated);
 }
 async function renderPanel(telegram:Telegram,id:number,d:EditorDraft){
  const panel=String(d.data.recruitPanel||"");
  const data=asInput(d),rev=d.revision;
  if(panel==="like"||panel==="love"){
   const purpose=panel;
   const index=typeof d.data.recruitTagCategory==="number"?d.data.recruitTagCategory:-1;
   const page=Number(d.data.recruitTagPage)||0;
   const callbacks={
    openCategory:(n:number)=>`recruit:tagcat:${rev}:${n}`,
    selectItem:(_category:number,n:number)=>`recruit:tagitem:${rev}:${n}`,
    changePage:(_category:number,n:number)=>`recruit:tagpage:${rev}:${n}`,
    save:`recruit:tagsave:${rev}`,back:`recruit:tagback:${rev}`,
    cancel:`recruit:cancel:${rev}`,
   };
   const tags=purpose==="like"?data.likeTags??[]:data.loveTags??[];
   const rows=index<0?roomRecruitmentCategoryRows(callbacks,purpose):
    roomRecruitmentTagRows(index,page,tags,callbacks,purpose);
   await show(telegram,id,d,roomRecruitmentTagHeading(purpose,index<0?undefined:index)+
    "\n選択中："+tags.length+"件",Markup.inlineKeyboard(rows));
   return;
  }
  let rows:any[][]=[];
  if(panel==="position"){
   rows=recruitmentSelectionRows(PROFILE_POSITIONS,true).map(group=>group.map(p=>
    b((data.position===p?"✅ ":"▫️ ")+p,
     `recruit:select:${rev}:position:${PROFILE_POSITIONS.indexOf(p)}`,"primary")));
  }else if(panel==="purpose"){
   rows=recruitmentSelectionRows(PURPOSE_TAGS,true).map(group=>group.map(t=>
    b((data.purposeCodes.includes(t)?"✅ ":"▫️ ")+t,
     `recruit:select:${rev}:purpose:${PURPOSE_TAGS.indexOf(t)}`,"primary")));
  }else if(panel==="place"){
   const items=["場所あり","場所なし","足あり"];
   rows=recruitmentSelectionRows(items,true).map(group=>group.map(t=>
    b((data.placeCodes.includes(t)?"✅ ":"▫️ ")+t,
     `recruit:select:${rev}:place:${items.indexOf(t)}`,"primary")));
  }else throw Error("RECRUITMENT_PANEL_INVALID");
  rows.push([b("↩ 戻る",`recruit:tagback:${rev}`),
   b("✅ 保存",`recruit:tagsave:${rev}`,"success"),
   b("キャンセル",`recruit:cancel:${rev}`,"danger")]);
  const ready=!!data.title?.trim();
  const profile=ready&&data.mode==="linked"?await getProfile(id):null;
  const preview=ready?renderRecruitmentPreview(data,profile):
   escapeProfileHtml(inputInstructions(data.mode==="linked"));
  const heading=panel==="position"?"ポジションを選択してください（1つ必須）。":
   panel==="purpose"?"目的タグを選択してください（複数選択可能）。":
   "場所あり／なしは択一、足ありは独立して選択できます。";
  await show(telegram,id,d,(d.data.publishedSourceId?"📢 公開済み募集を編集中\n":"📢 相手募集（未投稿）\n")+
   preview+"\n\n"+escapeProfileHtml(heading),Markup.inlineKeyboard(rows),true);
 }
 bot.action(/^recruit:tagcat:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const rev=Number(ctx.match[1]),cat=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,rev,"awaiting_tags")||!["like","love"].includes(String(d.data.recruitPanel))||
   d.data.recruitTagCategory!==null||!LIKE_CATEGORIES[cat]){
   await ctx.answerCbQuery("古い選択です");return;
  }
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",{
   ...d.data,recruitTagCategory:cat,recruitTagPage:0});
  await ctx.answerCbQuery();await renderPanel(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^recruit:tagitem:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const rev=Number(ctx.match[1]),idx=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,rev,"awaiting_tags")||!["like","love"].includes(String(d.data.recruitPanel))){
   await ctx.answerCbQuery("古い選択です");return;
  }
  const cat=Number(d.data.recruitTagCategory),page=Number(d.data.recruitTagPage)||0;
  if(d.data.recruitTagCategory===null||!LIKE_CATEGORIES[cat]){await ctx.answerCbQuery("分類を選択してください");return;}
  let bounds;
  try{bounds=likePageBounds(cat,page);}catch{await ctx.answerCbQuery("ページを選択し直してください");return;}
  if(idx<bounds.start||idx>=bounds.end){await ctx.answerCbQuery("古い選択です");return;}
  const field=d.data.recruitPanel==="love"?"loveTags":"likeTags";
  const changed=toggleLike(asInput(d)[field]??[],cat,idx);
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",{...d.data,[field]:changed});
  await ctx.answerCbQuery();await renderPanel(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^recruit:tagpage:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const rev=Number(ctx.match[1]),page=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,rev,"awaiting_tags")||!["like","love"].includes(String(d.data.recruitPanel))||
   d.data.recruitTagCategory===null){await ctx.answerCbQuery("古いページです");return;}
  try{likePageBounds(Number(d.data.recruitTagCategory),page);}catch{await ctx.answerCbQuery("ページがありません");return;}
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",{...d.data,recruitTagPage:page});
  await ctx.answerCbQuery();await renderPanel(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^recruit:(tagsave|tagback):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const op=ctx.match[1],rev=Number(ctx.match[2]);
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,rev,"awaiting_tags")){await ctx.answerCbQuery("古い選択です");return;}
  if(op==="tagback"&&["like","love"].includes(String(d.data.recruitPanel))&&
    typeof d.data.recruitTagCategory==="number"){
   const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",{
    ...d.data,recruitTagCategory:null,recruitTagPage:0});
   await ctx.answerCbQuery();await renderPanel(ctx.telegram,ctx.from.id,next);return;
  }
  await ctx.answerCbQuery();await leaveRecruitPanel(ctx.telegram,ctx.from.id,d);
 });
 bot.action(/^recruit:select:(\d+):(position|purpose|place):(\d{1,2})$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  const rev=Number(ctx.match[1]),panel=ctx.match[2],i=Number(ctx.match[3]);
  if(!active(d,rev,"awaiting_tags")||d.data.recruitPanel!==panel){
   await ctx.answerCbQuery("古い操作です");return;
  }
  const value=asInput(d),nextData={...d.data};
  if(panel==="position"){
   if(value.mode!=="manual"||i>=PROFILE_POSITIONS.length){await ctx.answerCbQuery("無効です");return;}
   nextData.position=PROFILE_POSITIONS[i];
  }else if(panel==="purpose"){
   const tag=PURPOSE_TAGS[i];
   if(!tag){await ctx.answerCbQuery("無効です");return;}
   const old=value.purposeCodes??[];
   nextData.purposeCodes=old.includes(tag)?old.filter(s=>s!==tag):[...old,tag];
  }else{
   if(i>2){await ctx.answerCbQuery("無効です");return;}
   const old=value.placeCodes??[];
   const chosen=i===0?"場所あり":i===1?"場所なし":null;
   const selected=chosen?(old.includes(chosen)?null:chosen):
    old.includes("場所あり")?"場所あり":old.includes("場所なし")?"場所なし":null;
   const transport=i===2?!old.includes("足あり"):old.includes("足あり");
   nextData.placeCodes=normalizePlaceCodes(selected,transport);
  }
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",nextData);
  await ctx.answerCbQuery();await renderPanel(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^recruit:published:edit:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const sourceId=Number(ctx.match[1]);
  try{
   const record=await loadPublishedRecruitment(ctx.from.id,sourceId);
   const profile=record.input.mode==="linked"?await getProfile(ctx.from.id):null;
   const d=await beginDraft(ctx.from.id,"announcement","preview",{
    ...record.input,kind:"recruitment",recruitmentFlow:"compact",
    recruitmentMode:record.input.mode,
    publishedSourceId:sourceId,publishedSourceRevision:record.sourceRevision,
    profileRevision:profile?.revision??null,
   });
   const message=ctx.callbackQuery.message;
   if(message&&"message_id" in message){
    await bindDraftScreen(ctx.from.id,"announcement",d.revision,message.message_id);
    d.data.screenMessageId=message.message_id;
   }
   await ctx.answerCbQuery();
   await showPreview(ctx.telegram,ctx.from.id,d);
  }catch{
   await ctx.answerCbQuery("公開済みの本人投稿を確認できませんでした",{show_alert:true});
  }
 });
 bot.action(/^recruit:published:delete:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const sourceId=Number(ctx.match[1]);
  try{
   await loadPublishedRecruitment(ctx.from.id,sourceId);
   await ctx.answerCbQuery();
   await ctx.editMessageText("🗑 この募集を削除しますか？\n投稿№："+sourceId+
    "\n削除すると元のグループ投稿も削除されます。",
    Markup.inlineKeyboard([[
     b("🗑 削除する","recruit:published:confirm:"+sourceId,"danger"),
     b("キャンセル","recruit:published:back:"+sourceId)
    ]]));
  }catch{await ctx.answerCbQuery("本人の公開済み募集を確認できませんでした",{show_alert:true});}
 });
 bot.action(/^recruit:published:back:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  try{
   const record=await loadPublishedRecruitment(ctx.from.id,Number(ctx.match[1]));
   await ctx.answerCbQuery();
   await showRecruitmentPublished(ctx,record);
  }catch{await ctx.answerCbQuery("投稿を確認できませんでした",{show_alert:true});}
 });
 bot.action(/^recruit:published:confirm:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const sourceId=Number(ctx.match[1]);
  await ctx.answerCbQuery("削除処理を確認しています");
  try{
   await deletePublishedRecruitment(ctx.telegram,ctx.from.id,sourceId);
   await ctx.editMessageText("✅ 募集を削除しました。\n投稿№："+sourceId);
  }catch{
   await ctx.editMessageText("⚠️ 削除を確認できませんでした。再投稿や自動再削除は行いません。"+
    "\n投稿№："+sourceId+"\n管理者による送信結果の照合が必要です。");
  }
 });
 // Old flat-topic page callbacks restart at the group-first picker.
 bot.action(/^recruit:targets:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]),"preview")){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,"groups");
 });
 bot.action(/^recruit:post:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  let d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]))||
     !["preview","awaiting_text","awaiting_tags"].includes(d.step)){
   await ctx.answerCbQuery("古い投稿ボタンです");return;
  }
  if(d.step==="awaiting_text"){
   await ctx.answerCbQuery("募集情報を入力してから投稿してください",{show_alert:true});
   return;
  }
  if(d.step==="awaiting_tags"){
   d=await updateDraft(ctx.from.id,"announcement",d.revision,"preview",{
    ...d.data,recruitPanel:null,recruitPanelReturnStep:null});
  }
  try{
   if(await checkLinkedProfileChanged(ctx.telegram,ctx.from.id,d)){
    await ctx.answerCbQuery("更新後の内容を確認してください");return;
   }
   validateRecruitmentReady(asInput(d),
    asInput(d).mode==="linked"?await getProfile(ctx.from.id):null);
   if(d.data.publishedSourceId){
    const sourceId=Number(d.data.publishedSourceId);
    const sourceRevision=Number(d.data.publishedSourceRevision);
    await ctx.answerCbQuery("元の投稿を更新しています");
    const updated=await applyPublishedRecruitmentEdit(
     ctx.telegram,ctx.from.id,sourceId,sourceRevision,asInput(d));
    // Remove the consumed private editor so it cannot steal future DM inputs.
    if(Number.isSafeInteger(d.data.screenMessageId)&&Number(d.data.screenMessageId)>0)
     await rememberPublishedRecruitmentDmScreen(ctx.from.id,sourceId,Number(d.data.screenMessageId));
    await markDraftPublished(ctx.from.id,"announcement",d.revision);
    await showRecruitmentPublished(ctx,updated);
    return;
   }
   const options=await listVerifiedTopics("announcement");
   const selected=options.find(t=>t.id===Number(d.data.selectedTopicId));
   if(!selected){
    await ctx.answerCbQuery("先に投稿先を選択してください");
    await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,"groups");
    return;
   }
   await ctx.answerCbQuery("投稿処理を確認しています");
   const sent=await publishRecruitment(ctx.telegram,ctx.from.id,d,selected.id,
    d.data.destinationExplicit===true);
   await showRecruitmentPublished(ctx,sent);
  }catch(e){
   const reason=e instanceof Error?e.message:"";
   if(reason.startsWith("TOPIC_ENTRY_")){
    await ctx.answerCbQuery("元の投稿先が使えないため選択してください").catch(()=>{});
    await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,"groups");
    return;
   }
   await ctx.answerCbQuery("投稿の条件を確認してください").catch(()=>{});
   await showPreview(ctx.telegram,ctx.from.id,d,
    e instanceof Error?e.message:"投稿状態を確認できませんでした。");
  }
 });
 // Old flat-topic buttons must not skip required hierarchy steps.
 bot.action(/^recruit:target:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]),"preview")){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  await showRecruitmentDestinationStep(ctx.telegram,ctx.from.id,d,"groups");
 });
 bot.action(/^recruit:cancel:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]))||
     !["preview","awaiting_text","awaiting_tags","awaiting_recruitment_edit"].includes(d.step)){
   await ctx.answerCbQuery("古い操作です");return;
  }
  // Published-edit cancellation must discard unsaved changes but preserve
  // both the public post and its private owner management screen.
  const sourceId=Number(d.data.publishedSourceId);
  const publication=Number.isSafeInteger(sourceId)&&sourceId>0?
   await loadPublishedRecruitment(ctx.from.id,sourceId):null;
  // Invalidate stale edit callbacks without changing the published record.
  await updateDraft(ctx.from.id,"announcement",d.revision,"cancelled",{
   recruitmentFlow:"compact",cancelled:true,screenMessageId:d.data.screenMessageId,
  });
  await ctx.answerCbQuery();
  if(publication)await showRecruitmentPublished(ctx,publication);
  else await editMessageToDmPostingMenu(ctx,ctx.from.id);
 });
}
