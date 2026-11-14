/** General-user notice participation, applicant view and Bot-mediated messaging.
 * Uses existing Announcement application records; no ROOM or profile state edits.
 */
import {Markup,type Context,type Telegraf,type Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {applicationTokenHash} from "../services/applicationLinks.js";
import {submitApplication,decideApplication} from "../services/announcementApplications.js";
import {escapeProfileHtml} from "../services/profileCore.js";
import {removeUserWizardInput,showWizardScreen} from "../services/dmWizardScreen.js";

type NoticeEntry={id:number;owner:number;text:string;participation:"none"|"public"|"approved_only";
 status:string;accept:boolean;deadline:Date|null};
function validId(n:number):number{
 if(!Number.isSafeInteger(n)||n<=0)throw Error("NOTICE_ID_INVALID");
 return n;
}
async function entry(token:string):Promise<NoticeEntry>{
 const hash=applicationTokenHash(token);
 const r=await pool.query(`
  SELECT p.announcement_id,p.owner_user_id,p.text,p.kind,p.status,p.accept_applications,
    p.deadline_at,p.conditions
   FROM announcement_application_entries e JOIN announcement_posts p
    ON p.announcement_id=e.announcement_id
   WHERE e.token_hash=$1 AND e.enabled=TRUE AND e.expires_at>NOW()
     AND p.kind IN ('announcement','preview') AND p.room_id IS NULL`,[hash]);
 if(r.rows.length!==1)throw Error("NOTICE_LINK_UNAVAILABLE");
 const p=r.rows[0],mode=p.conditions?.participation;
 if(mode!=="public"&&mode!=="approved_only"&&mode!=="none")throw Error("NOTICE_MODE_INVALID");
 return {id:validId(Number(p.announcement_id)),owner:validId(Number(p.owner_user_id)),
  text:String(p.text),participation:mode,status:p.status,accept:p.accept_applications===true,
  deadline:p.deadline_at?new Date(p.deadline_at):null};
}
export async function isNoticeApplicationLink(payload:string):Promise<boolean>{
 const match=/^a_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match)return false;
 try{await entry(match[1]!);return true;}catch{return false;}
}
function joinOpen(p:NoticeEntry):boolean{
 return p.status==="published"&&p.accept&&
  (!p.deadline||p.deadline.getTime()>Date.now());
}
export async function startNoticeApplication(ctx:Context,payload:string):Promise<void>{
 if(ctx.chat?.type!=="private"||!ctx.from)return;
 const match=/^a_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match){await ctx.reply("告知リンクを確認できません。");return;}
 try{
  const p=await entry(match[1]!);
  if(ctx.from.id===p.owner){
   await showNoticeOwner(ctx.telegram,ctx.from.id,p.id);return;
  }
  const keyboard=Markup.inlineKeyboard([
   ...(joinOpen(p)?[[Markup.button.callback(
    p.participation==="public"?"✅ 参加する":"📝 応募する",
    "notice:join:"+match[1])]]:[]),
   [Markup.button.callback("✉️ 主催者へ質問","notice:question:"+match[1])],
  ]);
  await ctx.reply((p.participation==="public"?"👥 自由参加":p.participation==="approved_only"?"📝 承認制":"📢 受付なし")+"｜告知/予告\n"+
   p.text.slice(0,1200)+(joinOpen(p)?"":"\n受付終了"),keyboard);
 }catch{await ctx.reply("この告知の入口を確認できません。");}
}
async function showNoticeOwner(telegram:Telegram,owner:number,id:number,screenId?:number){
 const r=await pool.query(`SELECT owner_user_id,text,status,conditions
   FROM announcement_posts WHERE announcement_id=$1`,[validId(id)]);
 if(r.rows.length!==1||Number(r.rows[0].owner_user_id)!==owner)
  throw Error("NOTICE_OWNER_MISMATCH");
 const a=await pool.query(`SELECT count(*) FILTER (WHERE status='accepted')::int AS accepted,
  count(*) FILTER (WHERE status IN ('submitted','held'))::int AS waiting
  FROM announcement_applications WHERE announcement_id=$1`,[id]);
 const counts=a.rows[0];
 await showWizardScreen(telegram,owner,screenId,
  "📢 告知/予告 管理\n"+String(r.rows[0].text).slice(0,700)+
  "\n参加者："+Number(counts.accepted)+"人／応募待ち："+Number(counts.waiting)+"人",
  Markup.inlineKeyboard([
   [Markup.button.callback("👥 参加者を見る",`notice:owner:list:${id}:0:accepted`),
    Markup.button.callback("🙋 応募者を見る",`notice:owner:list:${id}:0:waiting`)],
   [Markup.button.callback("✉️ 一斉DM",`notice:owner:broadcast:${id}:all`),
    Markup.button.callback("📨 DM履歴",`notice:owner:history:${id}`)],
  ]));
}
function safeName(snapshot:unknown):string{
 const v=snapshot&&typeof snapshot==="object"?snapshot as Record<string,unknown>:{};
 const handle=typeof v.username==="string"&&/^[A-Za-z0-9_]{5,32}$/.test(v.username)?
  "@"+v.username:null;
 return escapeProfileHtml((handle||String(v.firstName||"ユーザー")).slice(0,60));
}
async function listPeople(t:Telegram,owner:number,notice:number,page:number,filter:string,screenId?:number){
 if(!Number.isSafeInteger(page)||page<0||page>100000)throw Error("NOTICE_PAGE_INVALID");
 const ownerCheck=await pool.query("SELECT 1 FROM announcement_posts WHERE announcement_id=$1 AND owner_user_id=$2",
  [notice,owner]);
 if(ownerCheck.rows.length!==1)throw Error("NOTICE_OWNER_MISMATCH");
 const status=filter==="accepted"?"status='accepted'":"status IN ('submitted','held')";
 const r=await pool.query(`SELECT application_id,consented_profile,status
   FROM announcement_applications WHERE announcement_id=$1 AND ${status}
   ORDER BY application_id DESC LIMIT 11 OFFSET $2`,[notice,page*10]);
 const entries=r.rows.slice(0,10);
 const rows=entries.map(x=>[Markup.button.callback(
  safeName(x.consented_profile).replaceAll("&amp;","&").replaceAll("&lt;","<").replaceAll("&gt;",">"),
  `notice:owner:dm:${Number(x.application_id)}`)]);
 const nav=[];
 if(page>0)nav.push(Markup.button.callback("◀ 前へ",`notice:owner:list:${notice}:${page-1}:${filter}`));
 if(r.rows.length>10)nav.push(Markup.button.callback("次へ ▶",`notice:owner:list:${notice}:${page+1}:${filter}`));
 if(nav.length)rows.push(nav);
 rows.push([Markup.button.callback("↩ 戻る",`notice:owner:home:${notice}`)]);
 await showWizardScreen(t,owner,screenId,
  filter==="accepted"?"👥 参加者一覧（タップでDM）":"🙋 応募者一覧（タップでDM）",
  Markup.inlineKeyboard(rows));
}
async function setDm(t:Telegram,user:number,notice:number,recipient:number|null,scope:"individual"|"accepted"|"all",screenId?:number){
 await pool.query(`INSERT INTO notice_dm_sessions
 (owner_user_id,announcement_id,recipient_user_id,scope,screen_message_id,expires_at)
 VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '30 minutes')
 ON CONFLICT(owner_user_id) DO UPDATE SET announcement_id=EXCLUDED.announcement_id,
 recipient_user_id=EXCLUDED.recipient_user_id,scope=EXCLUDED.scope,
 screen_message_id=EXCLUDED.screen_message_id,expires_at=EXCLUDED.expires_at,updated_at=NOW()`,
 [user,notice,recipient,scope,screenId??null]);
 const shown=await showWizardScreen(t,user,screenId,"✉️ DM本文を送信してください。\nBotが対象者へ届けます。",
  Markup.inlineKeyboard([[Markup.button.callback("キャンセル",`notice:dm:cancel:${notice}`)]]));
 if(shown.messageId!==screenId)
  await pool.query("UPDATE notice_dm_sessions SET screen_message_id=$2 WHERE owner_user_id=$1",
   [user,shown.messageId]);
}
export function registerNoticeInteractionHandlers(bot:Telegraf):void{
 bot.action(/^notice:join:([A-Za-z0-9_-]{32})$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();
  try{
   const p=await entry(ctx.match[1]!);
   if(!joinOpen(p))throw Error("NOTICE_CLOSED");
   const user=ctx.from;
   const result=await submitApplication(p.id,user.id,{
    username:user.username||null,firstName:user.first_name||"ユーザー",source:"notice"});
   await ctx.editMessageText(
    p.participation==="public"?"✅ 参加者として登録しました。":
    "✅ 応募を受け付けました。主催者の連絡をお待ちください。");
   if(result.duplicate)await ctx.reply("以前の登録はそのまま保持されています。");
  }catch{await ctx.reply("参加登録を確認できません。受付状況を確認してください。");}
 });
 bot.action(/^notice:question:([A-Za-z0-9_-]{32})$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();
  try{
   const p=await entry(ctx.match[1]!);
   if(ctx.from.id===p.owner)throw Error("NOTICE_SELF_DM");
   await setDm(ctx.telegram,ctx.from.id,p.id,p.owner,"individual",
    "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
  }catch{await ctx.reply("質問の受付を確認できません。");}
 });
 bot.action(/^notice:owner:home:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();
  await showNoticeOwner(ctx.telegram,ctx.from.id,Number(ctx.match[1]),
   "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
 });
 bot.action(/^notice:owner:list:(\d+):(\d+):(accepted|waiting)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();
  try{await listPeople(ctx.telegram,ctx.from.id,Number(ctx.match[1]),
   Number(ctx.match[2]),ctx.match[3]!,
   "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);}
  catch{await ctx.reply("参加者一覧を確認できません。");}
 });
 bot.action(/^notice:owner:dm:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();
  const r=await pool.query(`SELECT a.announcement_id,a.applicant_user_id
   FROM announcement_applications a JOIN announcement_posts p ON p.announcement_id=a.announcement_id
   WHERE a.application_id=$1 AND p.owner_user_id=$2`,[Number(ctx.match[1]),ctx.from.id]);
  if(r.rows.length!==1){await ctx.reply("対象者を確認できません。");return;}
  await setDm(ctx.telegram,ctx.from.id,Number(r.rows[0].announcement_id),
   Number(r.rows[0].applicant_user_id),"individual",
   "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
 });
 bot.action(/^notice:owner:broadcast:(\d+):(all|accepted)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();
  const notice=Number(ctx.match[1]);
  const r=await pool.query("SELECT 1 FROM announcement_posts WHERE announcement_id=$1 AND owner_user_id=$2",
   [notice,ctx.from.id]);
  if(r.rows.length!==1){await ctx.reply("主催者ではありません。");return;}
  await setDm(ctx.telegram,ctx.from.id,notice,null,ctx.match[2] as "all"|"accepted",
   "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
 });
 bot.action(/^notice:owner:history:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();
  const id=Number(ctx.match[1]);
  const r=await pool.query(`SELECT m.content,m.state FROM notice_direct_messages m
   JOIN announcement_posts p ON p.announcement_id=m.announcement_id
   WHERE m.announcement_id=$1 AND p.owner_user_id=$2
   ORDER BY m.message_id DESC LIMIT 10`,[id,ctx.from.id]);
  await showWizardScreen(ctx.telegram,ctx.from.id,
   "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined,
   "📨 DM履歴\n"+(r.rows.length?
    r.rows.map(x=>"・"+String(x.content).slice(0,100)+"（"+x.state+"）").join("\n"):
    "送信履歴はありません"),
   Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",`notice:owner:home:${id}`)]]));
 });
 bot.action(/^notice:replymsg:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();
  const r=await pool.query(`SELECT announcement_id,sender_user_id FROM notice_direct_messages
    WHERE message_id=$1 AND recipient_user_id=$2 AND state='sent'`,
    [Number(ctx.match[1]),ctx.from.id]);
  if(r.rows.length!==1){await ctx.reply("返信先を確認できません。");return;}
  await setDm(ctx.telegram,ctx.from.id,Number(r.rows[0].announcement_id),
   Number(r.rows[0].sender_user_id),"individual",
   "message" in ctx.callbackQuery?ctx.callbackQuery.message?.message_id:undefined);
 });
 bot.action(/^notice:dm:cancel:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await pool.query("DELETE FROM notice_dm_sessions WHERE owner_user_id=$1 AND announcement_id=$2",
   [ctx.from.id,Number(ctx.match[1])]);
  await ctx.answerCbQuery();
  await ctx.editMessageText("DM作成をキャンセルしました。");
 });
 bot.on("text",async(ctx,next)=>{
  if(ctx.chat.type!=="private"||ctx.message.text.startsWith("/"))return next();
  const row=await pool.query(`SELECT announcement_id,recipient_user_id,scope,screen_message_id
    FROM notice_dm_sessions WHERE owner_user_id=$1 AND expires_at>NOW()`,[ctx.from.id]);
  if(row.rows.length!==1)return next();
  const session=row.rows[0],body=ctx.message.text.trim();
  if(!body||body.length>3000){await ctx.reply("DMは1〜3000文字です。");return;}
  const removed=await removeUserWizardInput(ctx.telegram,ctx.chat.id,ctx.message.message_id);
  const notice=Number(session.announcement_id);
  let recipients:number[]=[];
  if(session.scope==="individual"&&session.recipient_user_id)
   recipients=[Number(session.recipient_user_id)];
  else{
   const owner=await pool.query("SELECT 1 FROM announcement_posts WHERE announcement_id=$1 AND owner_user_id=$2",
    [notice,ctx.from.id]);
   if(owner.rows.length!==1)throw Error("NOTICE_BROADCAST_OWNER_MISMATCH");
   const people=await pool.query(`SELECT DISTINCT applicant_user_id FROM announcement_applications
    WHERE announcement_id=$1 AND status ${session.scope==="accepted"?"='accepted'":"IN ('accepted','submitted','held')"}`,[notice]);
   recipients=people.rows.map(x=>Number(x.applicant_user_id));
  }
  let sent=0,unknown=0;
  for(const recipient of recipients){
   if(recipient===ctx.from.id)continue;
   const saved=await pool.query(`INSERT INTO notice_direct_messages
     (announcement_id,sender_user_id,recipient_user_id,content)
     VALUES($1,$2,$3,$4) RETURNING message_id`,
    [notice,ctx.from.id,recipient,body]);
   const id=Number(saved.rows[0].message_id);
   try{
    const result=await ctx.telegram.sendMessage(recipient,
     "✉️ 告知/予告の連絡\n"+body,
     Markup.inlineKeyboard([[Markup.button.callback("↩ 返信",`notice:replymsg:${id}`)]]));
    await pool.query(`UPDATE notice_direct_messages SET state='sent',telegram_message_id=$2,
      sent_at=NOW() WHERE message_id=$1 AND state='sending'`,[id,result.message_id]);
    sent++;
   }catch{
    await pool.query("UPDATE notice_direct_messages SET state='needs_reconcile' WHERE message_id=$1",
     [id]);unknown++;
   }
  }
  await pool.query("DELETE FROM notice_dm_sessions WHERE owner_user_id=$1 AND announcement_id=$2",
   [ctx.from.id,notice]);
  await showWizardScreen(ctx.telegram,ctx.from.id,
   Number(session.screen_message_id)||undefined,
   "DM送信："+sent+"件／結果未確認："+unknown+"件"+(removed?"":"\n入力文は手動で削除してください。"));
 });
}
export async function showPublishedNoticeOwner(telegram:Telegram,owner:number,id:number,screenId?:number){
 await showNoticeOwner(telegram,owner,id,screenId);
}
