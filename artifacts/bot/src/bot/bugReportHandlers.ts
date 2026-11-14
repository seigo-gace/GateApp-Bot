/** Reports are entered in @GayBBS_bot DM and delivered to the already existing
 * Userbot Telegram user account. This module never opens an MTProto session.
 * Sending is at-most-once: uncertain Telegram responses are not auto-retried.
 */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {bareStartPostingExtra,defaultBareStartChatId,BARE_START_POSTING_TEXT}
 from "../services/dmBareStartPostingMenu.js";
import {currentMenuOrigin} from "../services/menuOriginRepository.js";
import {currentTopicDmEntry} from "../services/topicDmEntry.js";
import {showWizardScreen} from "../services/dmWizardScreen.js";

const REPORT_LIMIT=2000;
const REPORT_LABEL="🐞 不具合を報告";

function recipientId():number|null {
 const raw=process.env.GAYBBS_USERBOT_REPORT_CHAT_ID;
 if(!raw||!/^[1-9]\d{4,18}$/.test(raw))return null;
 const id=Number(raw);
 return Number.isSafeInteger(id)?id:null;
}
export function normalizeBugReport(value:string):string|null {
 const text=value.trim();
 return text.length>0&&text.length<=REPORT_LIMIT&&!text.startsWith("/")?text:null;
}
function menuMessageId(ctx:any):number|undefined {
 const msg=ctx.callbackQuery&&"message" in ctx.callbackQuery?
  ctx.callbackQuery.message:undefined;
 return Number.isSafeInteger(msg?.message_id)?msg.message_id:undefined;
}
const CANCEL=Markup.inlineKeyboard([
 [Markup.button.callback("↩ 投稿メニューへ戻る","dm:bug:cancel")],
]);
export async function startBugReport(t:Telegram,userId:number,screenId?:number):Promise<void>{
 await pool.query(
  `INSERT INTO gaybbs_bug_reports(owner_user_id,state) VALUES($1,'pending')
   ON CONFLICT (owner_user_id) WHERE state='pending'
   DO UPDATE SET updated_at=NOW()`,[userId]);
 await showWizardScreen(t,userId,screenId,
  "🐞 不具合を報告\n\nどのボタン・画面で何が起きたか、できるだけ具体的に入力してください。\n" +
  "例：相手募集→投稿するを押しても反応しない\n\n送信した文章は運営にのみ届けます。",
  CANCEL);
}
async function returnMenu(t:Telegram,id:number,screenId?:number):Promise<void>{
 const origin=await currentMenuOrigin(id);
 const topic=origin?null:await currentTopicDmEntry(id);
 const extra=await bareStartPostingExtra(defaultBareStartChatId(origin?.chatId??topic?.chatId));
 await showWizardScreen(t,id,screenId,BARE_START_POSTING_TEXT,extra);
}
async function submitReport(t:Telegram,userId:number,sourceId:number,body:string,
 username?:string):Promise<"delivered"|"queued"|"uncertain"|"missing">{
 const claim=await pool.query<{id:string}>(
  `UPDATE gaybbs_bug_reports SET state='forwarding',body=$2,source_message_id=$3,
     updated_at=NOW() WHERE id=(
      SELECT id FROM gaybbs_bug_reports WHERE owner_user_id=$1 AND state='pending'
      ORDER BY id DESC LIMIT 1
     ) AND state='pending' RETURNING id`,
  [userId,body,sourceId]);
 if(claim.rows.length!==1)return "missing";
 const id=claim.rows[0].id;
 const recipient=recipientId();
 if(!recipient){
  await pool.query("UPDATE gaybbs_bug_reports SET state='queued',updated_at=NOW() WHERE id=$1",[id]);
  return "queued";
 }
 const safeUser=username&&/^[a-zA-Z0-9_]{5,32}$/.test(username)?("@"+username):"(username未設定)";
 const payload=REPORT_LABEL+"\n報告ID: "+id+"\nユーザー: "+userId+" "+safeUser+
  "\n報告内容:\n"+body;
 try{
  const message=await t.sendMessage(recipient,payload);
  await pool.query(
   `UPDATE gaybbs_bug_reports SET state='delivered',destination_message_id=$2,
    updated_at=NOW() WHERE id=$1`,[id,message.message_id]);
  return "delivered";
 }catch{
  // A timed-out request could have reached Telegram. Keep the record but
  // do not resend and risk duplicate operator notifications.
  await pool.query("UPDATE gaybbs_bug_reports SET state='uncertain',updated_at=NOW() WHERE id=$1",[id]);
  return "uncertain";
 }
}
export function registerBugReportHandlers(bot:Telegraf):void{
 bot.action("dm:bug:open",async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery();
  await startBugReport(ctx.telegram,ctx.from.id,menuMessageId(ctx));
 });
 bot.action("dm:bug:cancel",async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery();
  await pool.query(
   "UPDATE gaybbs_bug_reports SET state='cancelled',updated_at=NOW() WHERE owner_user_id=$1 AND state='pending'",
   [ctx.from.id]);
  await returnMenu(ctx.telegram,ctx.from.id,menuMessageId(ctx));
 });
 // Register before generic DM input handlers. Non-report messages pass through.
 bot.on("text",async(ctx,next)=>{
  if(ctx.chat.type!=="private"||!ctx.from||ctx.message.text.startsWith("/"))return next();
  const pending=await pool.query(
   "SELECT id FROM gaybbs_bug_reports WHERE owner_user_id=$1 AND state='pending' LIMIT 1",
   [ctx.from.id]);
  if(!pending.rows.length)return next();
  const text=normalizeBugReport(ctx.message.text);
  if(!text){
   await ctx.reply("報告内容を1〜2000文字で入力してください。");
   return;
  }
  const result=await submitReport(ctx.telegram,ctx.from.id,ctx.message.message_id,text,ctx.from.username);
  // A successful send is not a guarantee that the operator has read the report.
  const resultText=result==="delivered"?"✅ 不具合報告を運営宛に送信しました。ご協力ありがとうございます！":
   result==="queued"?"📝 報告内容を保存しました。運営宛の配送はまだ完了していません。":
   result==="uncertain"?"📝 報告内容を保存しました。送信結果を確認できないため、重複送信はしていません。":
   "この報告はすでに処理されています。";
  await ctx.reply(resultText);
  try{await ctx.deleteMessage(ctx.message.message_id);}catch{}
  await returnMenu(ctx.telegram,ctx.from.id);
 });
}


/** Only reports that were never sent (queued due to missing configuration)
 * may be retried. Uncertain Telegram sends remain parked for reconciliation.
 */
export function startBugReportDeliveryWorker(t:Telegram):()=>void {
 let busy=false;
 const tick=async()=>{
  if(busy||!recipientId())return;
  busy=true;
  try{
   const recipient=recipientId();
   if(!recipient)return;
   for(let n=0;n<5;n++){
    const claimed=await pool.query<{id:string;owner_user_id:string;body:string}>(
     `UPDATE gaybbs_bug_reports SET state='forwarding',updated_at=NOW()
       WHERE id=(SELECT id FROM gaybbs_bug_reports WHERE state='queued'
         ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id,owner_user_id,body`);
    if(!claimed.rows.length)break;
    const row=claimed.rows[0]!;
    try{
     const msg=await t.sendMessage(recipient,
      REPORT_LABEL+"\n報告ID: "+row.id+"\nユーザー: "+row.owner_user_id+
      "\n報告内容:\n"+row.body);
     await pool.query(
      "UPDATE gaybbs_bug_reports SET state='delivered',destination_message_id=$2,updated_at=NOW() WHERE id=$1",
      [row.id,msg.message_id]);
    }catch{
     await pool.query(
      "UPDATE gaybbs_bug_reports SET state='uncertain',updated_at=NOW() WHERE id=$1",
      [row.id]);
     break;
    }
   }
  }catch(error){
   console.error("BUG_REPORT_DELIVERY_WORKER_FAILED",
    error instanceof Error?error.name:"unknown");
  }finally{busy=false;}
 };
 void tick();
 const timer=setInterval(()=>{void tick();},60_000);
 return ()=>clearInterval(timer);
}
