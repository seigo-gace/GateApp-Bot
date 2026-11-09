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
import {currentTopicDmEntry,assertTopicDmEntryDestination,assertBoundTopicDmEntry,draftTopicEntryOrigin} from "../services/topicDmEntry.js";
import {editMessageToDmPostingMenu} from "../services/dmPostingMenuRestore.js";
import {listVerifiedTopics,getVerifiedTopic} from "../services/postingDelivery.js";
import {makeApplicationLink} from "../services/applicationLinks.js";
import {publishPost,assertFeatureReleased} from "../services/publishService.js";
import {showWizardScreen,removeUserWizardInput} from "../services/dmWizardScreen.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {buildRecruitmentRichPreview} from "../services/recruitmentRichPreview.js";
import {recruitmentSelectionRows} from "../services/recruitmentButtonLayout.js";
import {parseRecruitmentMessage,changeRecruitmentField,
 renderRecruitmentPreview,validateRecruitmentReady,type RecruitmentInput} from "../services/recruitmentCompose.js";

type EditField="title"|"nickname"|"stats"|"body";
const asInput=(d:EditorDraft)=>d.data as RecruitmentInput;
const active=(d:EditorDraft|null,rev:number,step?:string):d is EditorDraft=>
 !!d&&d.data.recruitmentFlow==="compact"&&d.revision===rev&&
 (!step||d.step===step);
async function show(telegram:Telegram,id:number,d:EditorDraft,text:string,keyboard?:any,html=false){
 const old=typeof d.data.screenMessageId==="number"?d.data.screenMessageId:undefined;
 const res=await showWizardScreen(telegram,id,old,text,html?{...keyboard,parse_mode:"HTML"}:keyboard);
 if(res.messageId!==old)await bindDraftScreen(id,"announcement",d.revision,res.messageId);
}
function b(text:string,id:string,style?:"primary"|"success"|"danger"){
 return {...Markup.button.callback(text,id),...(style?{style}:{})};
}
function keyboard(d:EditorDraft){
 const rev=d.revision;
 const data=asInput(d);
 const rows:any[][]=[];
 if(data.mode==="manual"){
  rows.push([b("📝 タイトル",`recruit:edit:${rev}:title`),
   b("📝 ニックネーム",`recruit:edit:${rev}:nickname`)]);
  rows.push([b("📝 身長/体重/年齢",`recruit:edit:${rev}:stats`),
   b("📝 募集内容",`recruit:edit:${rev}:body`)]);
  rows.push([b(data.position?"✅ ポジション":"ポジション選択",`recruit:panel:${rev}:position`,"primary"),
   b("目的選択",`recruit:panel:${rev}:purpose`,"success"),
   b("場所選択",`recruit:panel:${rev}:place`,"danger")]);
 }else{
  rows.push([b("📝 タイトル",`recruit:edit:${rev}:title`),
   b("📝 募集内容",`recruit:edit:${rev}:body`)]);
  rows.push([b("目的タグ",`recruit:panel:${rev}:purpose`,"success"),
   b("場所タグ",`recruit:panel:${rev}:place`,"primary")]);
 }
 rows.push([b("✅ 投稿",`recruit:post:${rev}`,"success"),
  b("キャンセル",`recruit:cancel:${rev}`)]);
 return Markup.inlineKeyboard(rows);
}
function initialKeyboard(d:EditorDraft){
 const rev=d.revision;
 return Markup.inlineKeyboard([
  [b("ポジション選択",`recruit:panel:${rev}:position`,"primary"),
   b("目的選択",`recruit:panel:${rev}:purpose`,"success"),
   b("場所選択",`recruit:panel:${rev}:place`,"danger")],
  [b("キャンセル",`recruit:cancel:${rev}`)]
 ]);
}
function inputInstructions(linked:boolean){
 return linked?
  "📢 相手募集を作成\n保存済みプロフィールと連動します。募集内容だけを1通で送信してください。\n\n"+
   "1行目：タイトル\n2行目以降：募集内容（改行自由）\n\n例：\n今夜遊べる人募集\n会える方を探しています。\n時間は相談で決めたいです。":
  "📢 相手募集を作成\nプロフィール未登録のため、この募集だけに使う情報を1通で入力してください。"+
  "\n\n1行目：タイトル\n2行目：ニックネーム\n3行目：身長 体重 年齢"+
  "\n4行目以降：募集内容（改行自由）\n\n例：\n今夜遊べる人募集\nゼロ\n175 80 40\n会える方を探しています。\n時間は相談で決めたいです。";
}
async function showPreview(telegram:Telegram,id:number,d:EditorDraft,warning=""){
 const input=asInput(d);
 const profile=input.mode==="linked"?await getProfile(id):null;
 const pinned=await currentTopicDmEntry(id);
 const origin=pinned?null:await currentMenuOrigin(id);
 const activeOrigin=pinned??origin;
 const destinations=await listVerifiedTopics("announcement");
 const bound=draftTopicEntryOrigin(d.data.entryChatId,d.data.entryThreadId);
 const changed=!!bound&&
   (!activeOrigin||activeOrigin.chatId!==bound.chatId||activeOrigin.threadId!==bound.threadId);
 const current=changed?null:
   activeOrigin?destinations.find(t=>t.chatId===activeOrigin.chatId&&t.threadId===activeOrigin.threadId):null;
 const rawDestination=changed?"投稿先：元Topicの入口が変更されています。この下書きからは公開できません。":
   current?"投稿先："+current.board+" / "+current.title:
   pinned?"投稿先：元Topicがこの投稿用途では未認証のため公開できません。":
   "投稿先：未選択。［投稿］で検証済みTopicを選択できます。";
 const fullKeyboard=keyboard(d);
 // The Rich editor has buttons beside the field text. Keep only the shared
 // selectors/publish/back buttons below it; plain mode uses all edit buttons.
 const actionRows=fullKeyboard.reply_markup.inline_keyboard.filter(row=>
  !row.some(button=>"callback_data" in button&&
    String(button.callback_data).startsWith("recruit:edit:")));
 try{
  const api=telegram as unknown as {callApi:(method:string,payload:Record<string,unknown>)=>Promise<any>};
  const old=typeof d.data.screenMessageId==="number"?d.data.screenMessageId:undefined;
  const rich=buildRecruitmentRichPreview(input,d.revision,rawDestination,warning,profile);
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
 await show(telegram,id,d,"📢 公開前プレビュー（未投稿)\n"+
  renderRecruitmentPreview(input,profile)+"\n\n"+escapeProfileHtml(rawDestination)+
  "\n\n📝各項目を変更しても他の入力は保持します。"+
  (warning?"\n"+escapeProfileHtml(warning):""),fullKeyboard,true);
}
export async function startCompactRecruitmentEditor(telegram:Telegram,userId:number,menuMessageId?:number){
 const previous=await getDraft(userId,"announcement");
 if(previous?.data.recruitmentFlow==="compact"){
  if(previous.step==="preview"){
   await showPreview(telegram,userId,previous);return;
  }
  if(["awaiting_tags","awaiting_recruitment_edit"].includes(previous.step)){
   const returnStep=previous.step==="awaiting_tags"&&
     previous.data.recruitPanelReturnStep==="awaiting_text"?"awaiting_text":"preview";
   const restored=await updateDraft(userId,"announcement",previous.revision,returnStep,
    {...previous.data,recruitPanel:null,recruitPanelReturnStep:null,editField:null});
   if(returnStep==="awaiting_text"){
    await show(telegram,userId,restored,inputInstructions(false),initialKeyboard(restored));
   }else{
    await showPreview(telegram,userId,restored);
   }
   return;
  }
  if(previous.step==="awaiting_text"){
   await show(telegram,userId,previous,inputInstructions(previous.data.mode==="linked"),
    previous.data.mode==="manual"?initialKeyboard(previous):
    Markup.inlineKeyboard([[b("キャンセル",`recruit:cancel:${previous.revision}`)]]));return;
  }
 }
 const profile=await getProfile(userId);
 const pinned=await currentTopicDmEntry(userId);
 const origin=pinned?null:await currentMenuOrigin(userId);
 const entry=pinned??origin;
 const linked=!!profile&&isProfilePosition(profile.position??"");
 const d=await beginDraft(userId,"announcement","awaiting_text",{
  kind:"recruitment",recruitmentFlow:"compact",
  recruitmentMode:linked?"linked":"manual",
  mode:linked?"linked":"manual",profileRevision:linked?profile!.revision:null,
  purposeCodes:[],placeCodes:[],
  ...(entry?{entryChatId:entry.chatId,entryThreadId:entry.threadId}:{}),
 });
 if(Number.isSafeInteger(menuMessageId)&&Number(menuMessageId)>0){
  await bindDraftScreen(userId,"announcement",d.revision,Number(menuMessageId));
  d.data.screenMessageId=Number(menuMessageId);
 }
 await show(telegram,userId,d,inputInstructions(linked),
  linked?Markup.inlineKeyboard([[b("キャンセル",`recruit:cancel:${d.revision}`)]]):initialKeyboard(d));
}
async function publishRecruitment(
 telegram:Telegram,owner:number,d:EditorDraft,topicId:number
):Promise<{chatId:number;threadId:number;messageId:number}>{
 const data=asInput(d);
 const profile=data.mode==="linked"?await getProfile(owner):null;
 validateRecruitmentReady(data,profile);
 if(data.mode==="linked"&&profile?.revision!==d.data.profileRevision)
  throw new Error("プロフィールが更新されています。更新後の内容を再確認してください。");
 const topic=await getVerifiedTopic(topicId,"announcement");
 const pinned=await currentTopicDmEntry(owner);
 const origin=pinned?null:await currentMenuOrigin(owner);
 const bound=draftTopicEntryOrigin(d.data.entryChatId,d.data.entryThreadId);
 assertBoundTopicDmEntry(bound,pinned??origin,{chatId:topic.chatId,threadId:topic.threadId});
 await assertTopicDmEntryDestination(owner,topic.chatId,topic.threadId);
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
  ...(data.mode==="manual"?{
   nickname:data.nickname,heightCm:data.heightCm,weightKg:data.weightKg,
   age:data.age,position:data.position,
  }:{}),
 };
 const ann=await createAnnouncement(owner,d.revision,"recruitment",data.body,
  undefined,data.purposeCodes,data.placeCodes,undefined,
  {profileSnapshot:snapshot,conditions});
 const link=await makeApplicationLink(owner,Number(ann.sourceId));
 const sent=await publishPost(telegram,{
  sourceType:"announcement",destinationPurpose:"announcement",sourceId:ann.sourceId,
  ownerId:owner,revision:d.revision,topicId,text,approved:true,
  buttons:[[{text:"📨 応募する（Bot DM）",url:link}]],
 });
 await markPostSourcePublished(owner,"announcement",ann.sourceId);
 await markDraftPublished(owner,"announcement",d.revision);
 return sent;
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
  if(await currentDmTextOwner(ctx.from.id)!=="announcement")return next();
  const d=await getDraft(ctx.from.id,"announcement");
  if(!d||d.data.recruitmentFlow!=="compact"||
     !["awaiting_text","awaiting_recruitment_edit"].includes(d.step))return next();
  const cleared=await removeUserWizardInput(ctx.telegram,ctx.chat.id,ctx.message.message_id);
  const warning=cleared?"":"⚠️ 入力メッセージを削除できませんでした。手動で削除してください。";
  try{
   if(d.step==="awaiting_text"){
    const input=parseRecruitmentMessage(ctx.message.text,d.data.mode==="linked");
    const updated=await updateDraft(ctx.from.id,"announcement",d.revision,"preview",{
     ...d.data,...input,
     purposeCodes:d.data.purposeCodes??[],placeCodes:d.data.placeCodes??[],
     position:input.mode==="manual"?(d.data.position??input.position):input.position,
     editField:null});
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
   await show(ctx.telegram,ctx.from.id,d,
    "入力内容を確認してください。\n"+(e instanceof Error?e.message:"入力エラー")+
    "\n再入力してください。"+(warning?"\n"+warning:""));
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
 bot.action(/^recruit:panel:(\d+):(position|purpose|place)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  const rev=Number(ctx.match[1]),panel=ctx.match[2];
  if(!active(d,rev)||!["preview","awaiting_text","awaiting_tags"].includes(d.step)||
    (panel==="position"&&asInput(d).mode!=="manual")){
   await ctx.answerCbQuery("古い操作です");return;
  }
  const next=await updateDraft(ctx.from.id,"announcement",rev,"awaiting_tags",{
   ...d.data,recruitPanel:panel,recruitPanelReturnStep:d.step==="awaiting_tags"?d.data.recruitPanelReturnStep:d.step});
  await ctx.answerCbQuery();
  await renderPanel(ctx.telegram,ctx.from.id,next);
 });
 async function renderPanel(telegram:Telegram,id:number,d:EditorDraft){
  const panel=d.data.recruitPanel as string;
  const data=asInput(d);
  let rows:any[][]=[];
  if(panel==="position"){
   rows=recruitmentSelectionRows(PROFILE_POSITIONS,true).map(group=>group.map(p=>
    b((data.position===p?"✅ ":"▫️ ")+p,
      `recruit:select:${d.revision}:position:${PROFILE_POSITIONS.indexOf(p)}`,"primary")));
  }
  if(panel==="purpose"){
   rows=recruitmentSelectionRows(PURPOSE_TAGS).map(group=>group.map(t=>
    b((data.purposeCodes?.includes(t)?"✅ ":"▫️ ")+t,
      `recruit:select:${d.revision}:purpose:${PURPOSE_TAGS.indexOf(t)}`,"success")));
  }
  if(panel==="place"){
   const items=["場所あり","場所なし","足あり"];
   rows=recruitmentSelectionRows(items).map(group=>group.map(p=>
    b((data.placeCodes?.includes(p)?"✅ ":"▫️ ")+p,
      `recruit:select:${d.revision}:place:${items.indexOf(p)}`)));
  }
  const rev=d.revision;
  rows.push(data.mode==="manual"?[
   b("ポジション選択",`recruit:panel:${rev}:position`,"primary"),
   b("目的選択",`recruit:panel:${rev}:purpose`,"success"),
   b("場所選択",`recruit:panel:${rev}:place`,"danger")]:[
   b("目的選択",`recruit:panel:${rev}:purpose`,"success"),
   b("場所選択",`recruit:panel:${rev}:place`,"danger")]);
  rows.push([b("📋 プレビュー",`recruit:panelback:${rev}`),
   b("キャンセル",`recruit:cancel:${rev}`)]);
  const ready=!!data.title?.trim()&&!!data.body?.trim();
  const profile=ready&&data.mode==="linked"?await getProfile(id):null;
  const preview=ready?renderRecruitmentPreview(data,profile):
   escapeProfileHtml(inputInstructions(data.mode==="linked"));
  const selected="選択済み：\n"+
   "ポジション："+escapeProfileHtml(data.mode==="linked"?
    (profile&&"position" in profile&&typeof profile.position==="string"?profile.position:"プロフィール参照"):(data.position??"未選択"))+"\n"+
   "目的："+escapeProfileHtml(data.purposeCodes?.join("、")||"未選択")+"\n"+
   "場所："+escapeProfileHtml(data.placeCodes?.join("、")||"未選択");
  const heading=panel==="position"?"ポジションを選択してください（1つ必須）。":
   panel==="purpose"?"目的タグを選択してください（複数選択可能）。":
   "場所あり／なしは択一、足ありは独立して選択できます。";
  await show(telegram,id,d,"📢 募集プレビュー（未投稿）\n"+preview+
   "\n\n"+selected+"\n\n"+escapeProfileHtml(heading),
   Markup.inlineKeyboard(rows),true);
 }
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
 bot.action(/^recruit:panelback:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]),"awaiting_tags")){
   await ctx.answerCbQuery("古い操作です");return;
  }
  const returnStep=d.data.recruitPanelReturnStep==="awaiting_text"?"awaiting_text":"preview";
  const next=await updateDraft(ctx.from.id,"announcement",d.revision,returnStep,
   {...d.data,recruitPanel:null,recruitPanelReturnStep:null});
  await ctx.answerCbQuery();
  if(returnStep==="awaiting_text"){
   await show(ctx.telegram,ctx.from.id,next,inputInstructions(false),initialKeyboard(next));
  }else{
   await showPreview(ctx.telegram,ctx.from.id,next);
  }
 });
 bot.action(/^recruit:post:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]),"preview")){
   await ctx.answerCbQuery("古い投稿ボタンです");return;
  }
  try{
   if(await checkLinkedProfileChanged(ctx.telegram,ctx.from.id,d)){
    await ctx.answerCbQuery("更新後の内容を確認してください");return;
   }
   validateRecruitmentReady(asInput(d),
    asInput(d).mode==="linked"?await getProfile(ctx.from.id):null);
   const options=await listVerifiedTopics("announcement");
   const pinned=await currentTopicDmEntry(ctx.from.id);
   const origin=pinned?null:await currentMenuOrigin(ctx.from.id);
   const preferred=pinned?options.find(t=>t.chatId===pinned.chatId&&t.threadId===pinned.threadId):
     origin?options.find(t=>t.chatId===origin.chatId&&t.threadId===origin.threadId):null;
   if(pinned&&!preferred)throw Error("元Topicが募集投稿先として認証されていません。");
   if(preferred){
    await ctx.answerCbQuery("投稿処理を確認しています");
    const sent=await publishRecruitment(ctx.telegram,ctx.from.id,d,preferred.id);
    await ctx.editMessageText("✅ 募集を投稿しました。\n投稿先："+sent.chatId+
     " / Topic "+sent.threadId+"\n投稿ID："+sent.messageId);
    return;
   }
   if(!options.length)throw Error("公開先のTopicがまだ認証されていません。下書きは保持しました。");
   await ctx.answerCbQuery("投稿先を選択してください");
   await ctx.editMessageText("投稿先を選択してください。選択先へこの内容を投稿します。",
    Markup.inlineKeyboard(options.slice(0,25).map(t=>[
     b(t.board+" / "+t.title,`recruit:target:${d.revision}:${t.id}`)])));
  }catch(e){
   await ctx.answerCbQuery("投稿の条件を確認してください").catch(()=>{});
   await showPreview(ctx.telegram,ctx.from.id,d,
    e instanceof Error?e.message:"投稿状態を確認できませんでした。");
  }
 });
 bot.action(/^recruit:target:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]),"preview")){
   await ctx.answerCbQuery("古い操作です");return;
  }
  try{
   await ctx.answerCbQuery("投稿しています");
   if(await checkLinkedProfileChanged(ctx.telegram,ctx.from.id,d))return;
   const sent=await publishRecruitment(ctx.telegram,ctx.from.id,d,Number(ctx.match[2]));
   await ctx.editMessageText("✅ 募集を投稿しました。\n投稿先："+sent.chatId+
    " / Topic "+sent.threadId+"\n投稿ID："+sent.messageId);
  }catch(e){
   const reason=e instanceof Error?e.message:"";
   if(reason.startsWith("TOPIC_ENTRY_")||reason==="FEATURE_RELEASE_NOT_VERIFIED"){
    await showPreview(ctx.telegram,ctx.from.id,d,
     reason==="FEATURE_RELEASE_NOT_VERIFIED"
      ?"公開許可が確認できません。下書きを保持しました。"
      :"元Topicの投稿先が一致しません。この下書きからは別Topicへ公開できません。");
    return;
   }
   await ctx.reply("投稿を確認できませんでした。送信状態が不明な場合は再送せず照合してください。");
  }
 });
 bot.action(/^recruit:cancel:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await getDraft(ctx.from.id,"announcement");
  if(!active(d,Number(ctx.match[1]))||
     !["preview","awaiting_text","awaiting_tags","awaiting_recruitment_edit"].includes(d.step)){
   await ctx.answerCbQuery("古い操作です");return;
  }
  // Cancel only this private recruitment, invalidating its old callbacks.
  // Previously published content and the independent profile are untouched.
  await updateDraft(ctx.from.id,"announcement",d.revision,"cancelled",{
   recruitmentFlow:"compact",cancelled:true,screenMessageId:d.data.screenMessageId,
  });
  await ctx.answerCbQuery();
  await editMessageToDmPostingMenu(ctx,ctx.from.id);
 });
}
