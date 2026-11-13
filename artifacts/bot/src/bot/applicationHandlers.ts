/** Recruitment is an Announcement business workflow; not an MPB handler.
 * DM consent precedes profile snapshot transfer to the announcement owner.
 */
import {Markup,type Telegraf,type Context} from "telegraf";
import {pool} from "../db/index.js";
import {getProfile} from "../services/profileRepository.js";
import {renderPublicProfile,escapeProfileHtml} from "../services/profileCore.js";
import {resolveApplicationSession,legacyRecruitmentContactOwner,
 activateApplicationSession,isRoomApplicationLink} from "../services/applicationLinks.js";
import {ownerUsernameLink} from "../services/telegramUsernameLink.js";
import {submitApplication,decideApplication,withdrawApplication,renderRoomApplicantSummary} from "../services/announcementApplications.js";
import {parseRecruitmentMessage,validateRecruitmentIdentityReady,type RecruitmentInput} from "../services/recruitmentCompose.js";
import {PROFILE_POSITIONS,isProfilePosition} from "../services/profileCore.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {showWizardScreen,removeUserWizardInput} from "../services/dmWizardScreen.js";
import {applicantDmLink} from "../services/telegramUsernameLink.js";
import {applicationTagRows,applicationTagValues,renderRoomApplicationPreview} from "../services/roomApplicationTags.js";
import {LIKE_CATEGORIES,likePageIndex,toggleLike,validLikeTags,type ProfileTagPurpose} from "../services/profileLike.js";

/** Existing plain-recruitment links keep direct owner contact.
 * Only a linked ROOM post uses the application/approval flow.
 */
export async function startApplicationEditor(ctx:Context,payload:string):Promise<void>{
 if(ctx.chat?.type!=="private"||!ctx.from)return;
 const roomLink=await isRoomApplicationLink(payload);
 if(!roomLink){
  try{
   const owner=await legacyRecruitmentContactOwner(payload);
   const url=await ownerUsernameLink(ctx.telegram,owner);
   await ctx.reply("🔗 募集者へ連絡してください。",
    Markup.inlineKeyboard([[Markup.button.url("🔗 募集者へ連絡",url)]]));
  }catch{
   await ctx.reply("この募集リンクを確認できません。");
  }
  return;
 }
 try{
  const source=await activateApplicationSession(ctx.from.id,payload);
  const profile=await getProfile(ctx.from.id);
  const linked=!!profile&&isProfilePosition(profile.position??"");
  const sent=await ctx.reply(applicationEntryText(linked,source.body),
   applicationEntryKeyboard(linked));
  await pool.query(
   "UPDATE announcement_application_sessions SET screen_message_id=$2,draft=$3::jsonb WHERE applicant_user_id=$1 AND draft_step='awaiting_text'",
   [ctx.from.id,sent.message_id,JSON.stringify({
    mode:linked?"linked":"manual",
    ...(linked?{profileRevision:profile!.revision,position:profile!.position,
      likeTags:validLikeTags(profile!.likeTags??[]),
      loveTags:validLikeTags(profile!.loveTags??[])}:{likeTags:[],loveTags:[]})
   })]);
 }catch{
  await ctx.reply("このROOMは現在応募できません。開始状況や受付状態をご確認ください。");
 }
}
/** Initial ROOM applicant panel: all selectors are accessible BEFORE text entry.
 * They use the same draft and callbacks as the later preview. */
function applicationEntryText(linked:boolean,source:string):string{
 return "📝 ROOMへの応募\n"+
  (linked?"保存済みプロフィールを使用します。\n1行目：応募タイトル\n2行目以降：応募内容":
   "1行目：タイトル\n2行目：ニックネーム\n3行目：身長 体重 年齢\n4行目以降：応募内容")+
  "\n\n必要なボタンを選択してからテキストを送信できます。"+
  "\n選択は保持され、プレビューに反映されます。"+
  "\n募集："+source.slice(0,500);
}
function applicationEntryKeyboard(linked:boolean){
 return Markup.inlineKeyboard([
  ...(!linked?[[Markup.button.callback("🎯 ポジション","application:position")]]:[]),
  [Markup.button.callback("💖 #Like","application:tag:like:open"),
   Markup.button.callback("💘 #Love","application:tag:love:open")],
  [Markup.button.callback("キャンセル","application:cancel")]
 ]);
}
function retainApplicationChoices(data:RecruitmentInput,prior:Record<string,unknown>){
 return {...data,
  ...(!data.position&&typeof prior.position==="string"?{position:prior.position}:{}),
  likeTags:validLikeTags(prior.likeTags as []??[]),
  loveTags:validLikeTags(prior.loveTags as []??[])
 };
}
async function applicationEntry(telegram:Context["telegram"],id:number,screenId:number|undefined,linked:boolean){
 const r=await pool.query(
  `SELECT p.text AS body FROM announcement_application_sessions s
   JOIN announcement_application_entries e ON e.token_hash=s.token_hash
   JOIN announcement_posts p ON p.announcement_id=e.announcement_id
   WHERE s.applicant_user_id=$1 AND s.draft_step='awaiting_text'
     AND s.expires_at>NOW() AND e.enabled=TRUE AND e.expires_at>NOW()`,
  [id]);
 if(r.rows.length!==1)throw Error("ROOM_APPLICATION_ENTRY_EXPIRED");
 await showWizardScreen(telegram,id,screenId,
  applicationEntryText(linked,String(r.rows[0].body)),applicationEntryKeyboard(linked));
}

function applicationData(d:Record<string,unknown>):RecruitmentInput{
 return {...d,mode:d.mode==="linked"?"linked":"manual",
  title:String(d.title||""),body:String(d.body||""),
  purposeCodes:[],placeCodes:[],
 } as RecruitmentInput;
}
async function applicationPreview(telegram:Context["telegram"],id:number,data:Record<string,unknown>,
 screenId:number|undefined){
 const profile=data.mode==="linked"?await getProfile(id):null;
 const draft=applicationData(data);
 const text="📝 ROOM応募内容の確認\n"+renderRoomApplicationPreview({...draft,likeTags:validLikeTags(data.likeTags as []??[]),loveTags:validLikeTags(data.loveTags as []??[])},profile)+
  "\n\n内容を確認して［応募する］を押してください。";
 const rows:any[][]=[[
  Markup.button.callback("💖 #Like","application:tag:like:open"),
  Markup.button.callback("💘 #Love","application:tag:love:open")
 ]];
 if(data.mode!=="linked"&&!isProfilePosition(String(data.position||"")))
  rows.push([
   Markup.button.callback("ポジション選択","application:position"),
   Markup.button.callback("キャンセル","application:cancel")
  ]);
 else rows.push([
  Markup.button.callback("✅ 応募する","application:confirm"),
  Markup.button.callback("キャンセル","application:cancel")
 ]);
 await showWizardScreen(telegram,id,screenId,text,Markup.inlineKeyboard(rows),"HTML");
}
export function registerApplicationHandlers(bot:Telegraf):void{

 bot.on("text",async(ctx,next)=>{
  if(ctx.chat.type!=="private"||ctx.message.text.startsWith("/")||
     await currentDmTextOwner(ctx.from.id)!=="room_application")return next();
  const row=await pool.query(
   `SELECT s.screen_message_id FROM announcement_application_sessions s
     JOIN announcement_application_entries e ON e.token_hash=s.token_hash
     JOIN announcement_posts p ON p.announcement_id=e.announcement_id
     WHERE s.applicant_user_id=$1 AND s.expires_at>NOW()
       AND s.draft_step='awaiting_text'
       AND e.enabled=TRUE AND e.expires_at>NOW()
       AND p.status='published' AND p.accept_applications=TRUE
       AND p.room_id IS NOT NULL`,[ctx.from.id]);
  if(row.rows.length!==1)return next();
  const removed=await removeUserWizardInput(ctx.telegram,ctx.chat.id,ctx.message.message_id);
  const warning=removed?"":"\n⚠️ 入力テキストを削除できませんでした。";
  const screenId=Number(row.rows[0].screen_message_id)||undefined;
  try{
   const profile=await getProfile(ctx.from.id);
   const linked=!!profile&&isProfilePosition(profile.position??"");
   const data=parseRecruitmentMessage(ctx.message.text,linked);
   const previous=await pool.query(
    "SELECT draft FROM announcement_application_sessions WHERE applicant_user_id=$1 AND draft_step='awaiting_text' AND expires_at>NOW()",
    [ctx.from.id]);
   if(previous.rows.length!==1)throw Error("ROOM_APPLICATION_ENTRY_EXPIRED");
   const choices=retainApplicationChoices(data,previous.rows[0].draft as Record<string,unknown>);
   const draft={...choices,
    likeTags:(choices.likeTags as unknown[]).length?choices.likeTags:
     linked?validLikeTags(profile!.likeTags??[]):[],
    loveTags:(choices.loveTags as unknown[]).length?choices.loveTags:
     linked?validLikeTags(profile!.loveTags??[]):[],
    ...(linked?{profileRevision:profile!.revision,position:profile!.position}:{})};
   await pool.query(
    `UPDATE announcement_application_sessions
       SET draft=$2::jsonb,draft_step='preview'
       WHERE applicant_user_id=$1 AND draft_step='awaiting_text'`,
    [ctx.from.id,JSON.stringify(draft)]);
   await applicationPreview(ctx.telegram,ctx.from.id,draft,screenId);
   if(warning)await ctx.telegram.sendMessage(ctx.from.id,warning);
  }catch(error){
   await showWizardScreen(ctx.telegram,ctx.from.id,screenId,
    (error instanceof Error?error.message:"入力を確認してください。")+
    "\n\n内容を修正して再送信してください。"+warning,
    Markup.inlineKeyboard([[Markup.button.callback("キャンセル","application:cancel")]]));
  }
 });
 bot.action(/^application:tag:(like|love):open$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const purpose=ctx.match[1] as ProfileTagPurpose;
  const r=await pool.query(
   "SELECT draft,screen_message_id,draft_step FROM announcement_application_sessions WHERE applicant_user_id=$1 AND draft_step IN ('awaiting_text','preview') AND expires_at>NOW()",
   [ctx.from.id]);
  if(r.rows.length!==1){await ctx.answerCbQuery("古い操作です");return;}
  const screenId=Number(r.rows[0].screen_message_id);
  if(!Number.isSafeInteger(screenId)||screenId<1||
     ctx.callbackQuery.message?.message_id!==screenId){
   await ctx.answerCbQuery("古い操作です");return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageText("🏷️ #"+(purpose==="like"?"Like":"Love")+
   "\n"+(purpose==="like"?"自分の特徴・好み・趣味・スタイルを選択":"相手に求める特徴・好み・趣味・スタイルを選択"),
   Markup.inlineKeyboard(applicationTagRows(purpose,screenId,r.rows[0].draft)));
 });
 bot.action(/^application:tag:(like|love):(\d+):(open|back|save|tag|page|clear)(?::(\d+))?(?::(\d+))?$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const purpose=ctx.match[1] as ProfileTagPurpose;
  const screenId=Number(ctx.match[2]),action=ctx.match[3];
  const category=ctx.match[4]===undefined?undefined:Number(ctx.match[4]);
  const index=ctx.match[5]===undefined?undefined:Number(ctx.match[5]);
  const r=await pool.query(
   "SELECT draft,screen_message_id,draft_step FROM announcement_application_sessions WHERE applicant_user_id=$1 AND draft_step IN ('awaiting_text','preview') AND expires_at>NOW()",
   [ctx.from.id]);
  if(r.rows.length!==1 || Number(r.rows[0].screen_message_id)!==screenId ||
     ctx.callbackQuery.message?.message_id!==screenId){
   await ctx.answerCbQuery("古い操作です");return;
  }
  if(category!==undefined && (!Number.isInteger(category)||category<0||category>=LIKE_CATEGORIES.length)){
   await ctx.answerCbQuery("選択を確認してください");return;
  }
  let draft=r.rows[0].draft as Record<string,unknown>;
  let tags=applicationTagValues(draft,purpose);
  let selectedCategory=category;
  let page=0;
  if(action==="tag" || action==="clear"){
   if(category===undefined || (action==="tag" && (index===undefined||!Number.isInteger(index)))){
    await ctx.answerCbQuery("選択を確認してください");return;
   }
   tags=action==="tag"?toggleLike(tags,category,index!):
    tags.filter(t=>t.category!==LIKE_CATEGORIES[category]!.name);
   page=action==="tag"?likePageIndex(category,index!):0;
   const field=purpose==="like"?"likeTags":"loveTags";
   const updated=await pool.query(
    `UPDATE announcement_application_sessions
       SET draft=jsonb_set(draft,$2::text[], $3::jsonb, true)
       WHERE applicant_user_id=$1 AND draft_step IN ('awaiting_text','preview')
         AND screen_message_id=$4 AND expires_at>NOW()
       RETURNING draft`,
    [ctx.from.id,[field],JSON.stringify(tags),screenId]);
   if(updated.rows.length!==1){await ctx.answerCbQuery("古い操作です");return;}
   draft=updated.rows[0].draft as Record<string,unknown>;
  }else if(action==="page"){
   if(category===undefined||index===undefined){await ctx.answerCbQuery("選択を確認してください");return;}
   page=index;
  }else if(action==="back"||action==="save"){
   selectedCategory=undefined;
  }
  await ctx.answerCbQuery();
  const heading="🏷️ #"+(purpose==="like"?"Like":"Love")+
   (selectedCategory===undefined?"":"｜"+LIKE_CATEGORIES[selectedCategory]!.name)+
   "\n選択中："+applicationTagValues(draft,purpose).length+"件";
  await ctx.editMessageText(heading,Markup.inlineKeyboard(
   applicationTagRows(purpose,screenId,draft,selectedCategory,page)));
 });
 bot.action("application:position",async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const row=await pool.query(
   "SELECT draft FROM announcement_application_sessions WHERE applicant_user_id=$1 AND draft_step IN ('awaiting_text','preview') AND expires_at>NOW()",[ctx.from.id]);
  if(row.rows.length!==1||row.rows[0].draft?.mode==="linked"){
   await ctx.answerCbQuery("この操作は利用できません");return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageText("ポジションを選択してください。",
   Markup.inlineKeyboard([
    PROFILE_POSITIONS.slice(0,3).map((value,i)=>Markup.button.callback(value,`application:pos:${i}`)),
    PROFILE_POSITIONS.slice(3).map((value,i)=>Markup.button.callback(value,`application:pos:${i+3}`)),
    [Markup.button.callback("↩ 戻る","application:preview"),
     Markup.button.callback("キャンセル","application:cancel")]
   ]));
 });
 bot.action(/^application:pos:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const position=PROFILE_POSITIONS[Number(ctx.match[1])];
  if(!position)throw Error("APPLICATION_POSITION_INVALID");
  const r=await pool.query(
   `UPDATE announcement_application_sessions
     SET draft=jsonb_set(draft,'{position}',to_jsonb($2::text),true)
     WHERE applicant_user_id=$1 AND draft_step IN ('awaiting_text','preview') AND expires_at>NOW()
       RETURNING draft,screen_message_id,draft_step`,[ctx.from.id,position]);
  if(r.rows.length!==1){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  if(r.rows[0].draft_step==="awaiting_text")
   await applicationEntry(ctx.telegram,ctx.from.id,Number(r.rows[0].screen_message_id)||undefined,false);
  else await applicationPreview(ctx.telegram,ctx.from.id,r.rows[0].draft,
   Number(r.rows[0].screen_message_id)||undefined);
 });
 bot.action("application:preview",async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const r=await pool.query(
   "SELECT draft,screen_message_id,draft_step FROM announcement_application_sessions WHERE applicant_user_id=$1 AND draft_step IN ('awaiting_text','preview') AND expires_at>NOW()",
   [ctx.from.id]);
  if(r.rows.length!==1){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();
  if(r.rows[0].draft_step==="awaiting_text")
   await applicationEntry(ctx.telegram,ctx.from.id,Number(r.rows[0].screen_message_id)||undefined,
    r.rows[0].draft?.mode==="linked");
  else await applicationPreview(ctx.telegram,ctx.from.id,r.rows[0].draft,
   Number(r.rows[0].screen_message_id)||undefined);
 });
 bot.action("application:confirm",async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const session=await resolveApplicationSession(ctx.from.id);
  const record=await pool.query(
   "SELECT draft FROM announcement_application_sessions WHERE applicant_user_id=$1 AND draft_step='preview' AND expires_at>NOW()",
   [ctx.from.id]);
  if(!session||record.rows.length!==1){
   await ctx.answerCbQuery("受付終了または入力が未完了です");return;
  }
  const draft=applicationData(record.rows[0].draft as Record<string,unknown>);
  const profile=draft.mode==="linked"?await getProfile(ctx.from.id):null;
  try{
   validateRecruitmentIdentityReady(draft,profile);
  }catch{
   await ctx.answerCbQuery("必要項目を入力してください");return;
  }
  const snapshot={...draft,
   ...(profile?{nickname:profile.nickname,heightCm:profile.heightCm,
    weightKg:profile.weightKg,age:profile.age,position:profile.position}:{} ),
   likeTags:validLikeTags((record.rows[0].draft as Record<string,unknown>).likeTags as []??[]),
   loveTags:validLikeTags((record.rows[0].draft as Record<string,unknown>).loveTags as []??[])};
  let submitted:Awaited<ReturnType<typeof submitApplication>>;
  try{
   submitted=await submitApplication(session.announcementId,ctx.from.id,snapshot);
  }catch{
   await ctx.answerCbQuery("応募に失敗しました。募集状況をご確認ください。");
   return;
  }
  // The DB commit is the business result. Failing to update the wizard
  // screen/session must not falsely report the submitted application as FAIL.
  await pool.query(
   `UPDATE announcement_application_sessions SET draft_step='submitted'
     WHERE applicant_user_id=$1`,[ctx.from.id]).catch(()=>{
      console.warn("[ROOM_APPLICATION_SESSION_STEP_NEEDS_RECONCILE]");
     });
  await ctx.answerCbQuery("応募を受け付けました").catch(()=>undefined);
  const receipt=submitted.duplicate?
   "応募状況を確認しました："+submitted.status:
   "✅ 応募を送りました。主催者の承認・拒否をお待ちください。";
  const keyboard=["submitted","held"].includes(submitted.status)?
   Markup.inlineKeyboard([[Markup.button.callback("応募を取り下げる",
    `application:withdraw:${session.announcementId}`)]]):undefined;
  try{
   await ctx.editMessageText(receipt,keyboard);
  }catch{
   await ctx.telegram.sendMessage(ctx.from.id,receipt,keyboard).catch(()=>{
    console.warn("[ROOM_APPLICATION_SUBMISSION_RECEIPT_NEEDS_RECONCILE]");
   });
  }
 });
 bot.action("application:cancel",async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await pool.query(
   `UPDATE announcement_application_sessions SET draft_step='cancelled'
     WHERE applicant_user_id=$1`,[ctx.from.id]);
  await ctx.answerCbQuery("応募を中止しました");
  await ctx.editMessageText("応募を中止しました。応募は送信していません。");
 });
 bot.action("application:manage",async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const r=await pool.query(
   `SELECT ap.application_id,ap.status,ap.consented_profile,p.room_id
      FROM announcement_applications ap
      JOIN announcement_posts p ON p.announcement_id=ap.announcement_id
      WHERE p.owner_user_id=$1 AND p.kind='recruitment'
      ORDER BY ap.updated_at DESC LIMIT 10`,[ctx.from.id]);
  await ctx.answerCbQuery();
  if(!r.rows.length){
   await ctx.editMessageText("確認できる応募はありません。");
   return;
  }
  const rows=r.rows.map(x=>{
   const id=Number(x.application_id);
   const label=x.room_id!==null?
     "🎬 ROOM応募 "+id+"："+String(x.status):
     "応募 "+id+"："+String(x.status);
   return [Markup.button.callback(label,`application:manage:view:${id}`)];
  });
  await ctx.editMessageText("📨 応募管理\n確認する応募を選択してください。",
    Markup.inlineKeyboard(rows));
 });
 bot.action(/^application:manage:view:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const id=Number(ctx.match[1]);
  const r=await pool.query(
   `SELECT ap.status,ap.consented_profile,p.room_id
      FROM announcement_applications ap
      JOIN announcement_posts p ON p.announcement_id=ap.announcement_id
      WHERE ap.application_id=$1 AND p.owner_user_id=$2
        AND p.kind='recruitment'`,[id,ctx.from.id]);
  if(r.rows.length!==1){await ctx.answerCbQuery("応募が見つかりません");return;}
  const x=r.rows[0];
  const card=x.room_id!==null?
   renderRoomApplicantSummary(x.consented_profile as Record<string,unknown>|null):
   "応募 #"+id;
  const buttons:any[][]=[];
  if(["submitted","held"].includes(String(x.status)))
   buttons.push([
    Markup.button.callback("✅ 承認",`application:decide:${id}:accepted`),
    Markup.button.callback("❌ 拒否",`application:decide:${id}:declined`)
   ]);
  buttons.push([Markup.button.callback("↩ 応募管理へ戻る","application:manage")]);
  await ctx.answerCbQuery();
  await ctx.editMessageText(card+"\n状態："+String(x.status),
   {parse_mode:x.room_id!==null?"HTML":undefined,...Markup.inlineKeyboard(buttons)});
 });
 bot.command("applications",async ctx=>{
  if(ctx.chat.type!=="private")return;
  const rows=await pool.query(
   `SELECT a.application_id,a.status,a.consented_profile,
      p.announcement_id,p.room_id
    FROM announcement_applications a
    JOIN announcement_posts p ON p.announcement_id=a.announcement_id
    WHERE p.owner_user_id=$1 AND p.kind='recruitment'
    ORDER BY a.updated_at DESC LIMIT 25`,[ctx.from.id]);
  if(!rows.rows.length){await ctx.reply("受付中・処理済みの応募記録はありません。");return;}
  for(const row of rows.rows){
   const id=Number(row.application_id),active=["submitted","held"].includes(row.status);
   const isRoom=row.room_id!==null;
   const body=isRoom?
    renderRoomApplicantSummary(row.consented_profile as Record<string,unknown>|null):
    "募集 #"+row.announcement_id+" / 応募ID #"+id;
   const text=body+"\n状態："+String(row.status);
   const buttons=active?Markup.inlineKeyboard([
    [Markup.button.callback("✅ 承認",`application:decide:${id}:accepted`),
     Markup.button.callback("❌ 拒否",`application:decide:${id}:declined`)]
   ]):undefined;
   await ctx.reply(text,buttons?{parse_mode:isRoom?"HTML":undefined,...buttons}:undefined);
  }
 });
 bot.action(/^application:decide:(\d+):(accepted|held|declined)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const id=Number(ctx.match[1]),decision=ctx.match[2] as "accepted"|"held"|"declined";
  const row=await pool.query(
   "SELECT announcement_id,applicant_user_id,status FROM announcement_applications WHERE application_id=$1",[id]);
  if(row.rows.length!==1){await ctx.answerCbQuery("応募が見つかりません。");return;}
  let finalStatus=decision;
  let filled=false;
  try{
   const result=await decideApplication(ctx.from.id,Number(row.rows[0].announcement_id),id,decision);
   finalStatus=result.status;
   filled=result.filled;
  }catch{
   // A duplicate callback after a successful database commit is NOT a new
   // failed decision. Read back ownership and actual status before responding.
   const readback=await pool.query(
    `SELECT ap.status FROM announcement_applications ap
      JOIN announcement_posts p ON p.announcement_id=ap.announcement_id
      WHERE ap.application_id=$1 AND p.owner_user_id=$2`,[id,ctx.from.id]);
   if(readback.rows.length!==1||readback.rows[0].status!==decision){
    await ctx.answerCbQuery("処理できません。権限・受付状態を確認してください。");return;
   }
   finalStatus=decision;
  }
  // Business state is already committed. A Telegram edit or callback
  // acknowledgment failure must never be presented as a DB decision failure.
  await ctx.answerCbQuery("応募状態を更新しました").catch(()=>undefined);
  const applicantId=Number(row.rows[0].applicant_user_id);
  let username:unknown;
  try{
   const chat=await ctx.telegram.getChat(applicantId);
   username="username" in chat?chat.username:undefined;
  }catch{/* The existing deep-link fallback remains available. */}
  const receipt=(finalStatus==="accepted"?"✅ 応募を承諾しました。":
   finalStatus==="held"?"⏸ 応募を保留しました。":"❌ 応募を拒否しました。")+
   (filled?" 受付状態が更新されました。":"");
  const keyboard=Markup.inlineKeyboard([[
   Markup.button.url("💬 応募者へDM",applicantDmLink(applicantId,username))
  ]]);
  try{
   await ctx.editMessageText(receipt,keyboard);
  }catch{
   // Keep a usable owner receipt instead of returning a false business FAIL.
   await ctx.telegram.sendMessage(ctx.from.id,receipt,keyboard).catch(()=>{
    console.warn("[ROOM_APPLICATION_DECISION_RECEIPT_NEEDS_RECONCILE]");
   });
  }
 });
 bot.command("myapplications",async ctx=>{
  if(ctx.chat.type!=="private")return;
  const r=await pool.query(
   `SELECT application_id,announcement_id,status FROM announcement_applications
    WHERE applicant_user_id=$1 ORDER BY updated_at DESC LIMIT 25`,[ctx.from.id]);
  if(!r.rows.length){await ctx.reply("応募履歴はありません。");return;}
  for(const row of r.rows){
   const text="応募 #"+row.application_id+" / 募集 #"+row.announcement_id+" / "+row.status;
   await ctx.reply(text,["submitted","held"].includes(row.status)?
    Markup.inlineKeyboard([[Markup.button.callback("応募を取り下げる",
      `application:withdraw:${row.announcement_id}`)]]):undefined);
  }
 });
 bot.action(/^application:withdraw:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const changed=await withdrawApplication(ctx.from.id,Number(ctx.match[1]));
  await ctx.answerCbQuery(changed?"取り下げました":"変更できません");
  if(changed)await ctx.editMessageText("✅ この応募を取り下げました。");
 });
}
