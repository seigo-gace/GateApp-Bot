/** Recruitment is an Announcement business workflow; not an MPB handler.
 * DM consent precedes profile snapshot transfer to the announcement owner.
 */
import {Markup,type Telegraf,type Context} from "telegraf";
import {pool} from "../db/index.js";
import {getProfile} from "../services/profileRepository.js";
import {renderPublicProfile,escapeProfileHtml} from "../services/profileCore.js";
import {resolveApplicationSession,legacyRecruitmentContactOwner} from "../services/applicationLinks.js";
import {ownerUsernameLink} from "../services/telegramUsernameLink.js";
import {submitApplication,decideApplication,withdrawApplication} from "../services/announcementApplications.js";
/** Existing old Bot application links remain readable, but now only offer
 * the recruitment owner's username contact. No deadline or new application.
 */
export async function startApplicationEditor(ctx:Context,payload:string):Promise<void>{
 if(ctx.chat?.type!=="private"||!ctx.from)return;
 try{
  const owner=await legacyRecruitmentContactOwner(payload);
  const url=await ownerUsernameLink(ctx.telegram,owner);
  await ctx.reply("🔗 募集者へ連絡してください。",
   Markup.inlineKeyboard([[Markup.button.url("🔗 募集者へ連絡",url)]]));
 }catch{
  await ctx.reply("この旧投稿の募集者リンクを確認できません。投稿内容を確認してください。");
 }
}
export function registerApplicationHandlers(bot:Telegraf):void{
 bot.action("application:confirm",async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const session=await resolveApplicationSession(ctx.from.id);
  const profile=await getProfile(ctx.from.id);
  if(!session||!profile){
   await ctx.answerCbQuery("受付が終了したか、プロフィールがありません。");
   return;
  }
  const snapshot={nickname:profile.nickname,heightCm:profile.heightCm,
   weightKg:profile.weightKg,age:profile.age,position:profile.position};
  try{
   const r=await submitApplication(session.announcementId,ctx.from.id,snapshot);
   await ctx.answerCbQuery();
   await ctx.editMessageText(r.duplicate?
    "応募記録を確認しました。現在の状態："+r.status:
    "✅ 応募を受け付けました。募集主の判断をお待ちください。");
  }catch(e){
   await ctx.answerCbQuery("応募できませんでした。募集の受付状態をご確認ください。");
  }
 });
 bot.action("application:cancel",async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery("応募しません");
  await ctx.editMessageText("応募は取り消しました。応募データは作成していません。");
 });
 bot.command("applications",async ctx=>{
  if(ctx.chat.type!=="private")return;
  const rows=await pool.query(
   `SELECT a.application_id,a.applicant_user_id,a.status,p.announcement_id
    FROM announcement_applications a
    JOIN announcement_posts p ON p.announcement_id=a.announcement_id
    WHERE p.owner_user_id=$1 AND p.kind='recruitment'
    ORDER BY a.updated_at DESC LIMIT 25`,[ctx.from.id]);
  if(!rows.rows.length){await ctx.reply("受付中・処理済みの応募記録はありません。");return;}
  for(const row of rows.rows){
   const id=Number(row.application_id);
   const text="募集 #"+row.announcement_id+" / 応募ID #"+id+
    "\n応募者ID："+row.applicant_user_id+" / 状態："+row.status;
   const active=["submitted","held"].includes(row.status);
   await ctx.reply(text,active?Markup.inlineKeyboard([
    [Markup.button.callback("✅ 承認",`application:decide:${id}:accepted`)],
    [Markup.button.callback("⏸ 保留",`application:decide:${id}:held`)],
    [Markup.button.callback("❌ 辞退",`application:decide:${id}:declined`)],
   ]):undefined);
  }
 });
 bot.action(/^application:decide:(\d+):(accepted|held|declined)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const id=Number(ctx.match[1]);const decision=ctx.match[2] as "accepted"|"held"|"declined";
  const row=await pool.query(
   "SELECT announcement_id FROM announcement_applications WHERE application_id=$1",[id]);
  if(row.rows.length!==1){await ctx.answerCbQuery("応募が見つかりません。");return;}
  try{
   const result=await decideApplication(ctx.from.id,Number(row.rows[0].announcement_id),id,decision);
   await ctx.answerCbQuery("更新しました");
   await ctx.editMessageText("✅ 応募ID #"+id+" を "+result.status+" に更新しました。"+
    (result.filled?" 定員到達につき受付終了。":""));
  }catch{await ctx.answerCbQuery("処理できません。権限・人数・受付状態を確認してください。");}
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
