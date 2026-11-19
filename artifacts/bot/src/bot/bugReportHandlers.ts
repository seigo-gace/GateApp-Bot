/** Reports are entered in @GayBBS_bot DM and delivered to the already existing
 * Userbot Telegram user account. This module never opens an MTProto session.
 * Sending is at-most-once: uncertain Telegram responses are not auto-retried.
 */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {readFileSync} from "node:fs";
import {bareStartPostingExtra,defaultBareStartChatId}
 from "../services/dmBareStartPostingMenu.js";
import {currentMenuOrigin} from "../services/menuOriginRepository.js";
import {currentTopicDmEntry} from "../services/topicDmEntry.js";
import {showWizardScreen} from "../services/dmWizardScreen.js";

const REPORT_LIMIT=2000;
const REPORT_LABEL="🐞 不具合を報告";
const REPORT_PROMPT="🐞 不具合を報告\n\n下の入力欄に不具合の内容を書いて、そのまま送信してください。\n"+
  "コマンド入力や追加ボタンの操作は不要です。\n\n"+
  "例：相手募集の投稿ボタンを押しても反応しない\n\n"+
  "送信した内容はBotが保存し、入力メッセージの削除を試みます。\n"+
  "報告内容と受付結果はこのDMに表示します。";
export function bugReportInputErrorText(deleted:boolean):string{
 return REPORT_PROMPT+"\n\n報告内容を1〜2000文字で入力してください。"+
 (deleted?"":"\n※元の入力メッセージを削除できませんでした。手動で削除してください。");
}

function recipientId():number|null {
 let raw=process.env.GAYBBS_USERBOT_REPORT_CHAT_ID;
 if(!raw&&process.env.GAYBBS_USERBOT_REPORT_CHAT_ID_FILE){
  try{raw=readFileSync(process.env.GAYBBS_USERBOT_REPORT_CHAT_ID_FILE,"utf8").trim();}
  catch{return null;}
 }
 if(!raw||!/^[1-9]\d{4,18}$/.test(raw))return null;
 const id=Number(raw);
 return Number.isSafeInteger(id)?id:null;
}
/** Distinct user-account inbox; never silently reuse the operator's DM ID. */
function userbotRecipientId():number|null {
 let raw=process.env.GAYBBS_USERBOT_ACCOUNT_CHAT_ID;
 if(!raw&&process.env.GAYBBS_USERBOT_ACCOUNT_CHAT_ID_FILE){
  try{raw=readFileSync(process.env.GAYBBS_USERBOT_ACCOUNT_CHAT_ID_FILE,"utf8").trim();}
  catch{return null;}
 }
 if(!raw||!/^[1-9]\d{4,18}$/.test(raw))return null;
 const id=Number(raw);
 if(!Number.isSafeInteger(id)||id===recipientId())return null;
 return id;
}

export function normalizeBugReport(value:string):string|null {
 const text=value.trim();
 return text.length>0&&text.length<=REPORT_LIMIT&&!text.startsWith("/")?text:null;
}
export function bugReportPreview(text:string):string {
 return "🐞 不具合報告を受け付けました。\n\n【報告内容】\n"+text+
  "\n\nご不便をおかけして申し訳ありません。ご報告ありがとうございます。"+
  "内容を確認し、改善に努めます。対応までお時間をいただく場合があります。";
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
   DO UPDATE SET body=NULL,source_message_id=NULL,prompt_message_id=NULL,updated_at=NOW()`,[userId]);
 const prompt=await showWizardScreen(t,userId,screenId,REPORT_PROMPT,CANCEL);
 await pool.query(
  "UPDATE gaybbs_bug_reports SET prompt_message_id=$2,updated_at=NOW() WHERE owner_user_id=$1 AND state='pending'",
  [userId,prompt.messageId]);
}
async function returnMenu(t:Telegram,id:number,screenId?:number):Promise<void>{
 const origin=await currentMenuOrigin(id);
 const topic=origin?null:await currentTopicDmEntry(id);
 const extra=await bareStartPostingExtra(defaultBareStartChatId(origin?.chatId??topic?.chatId));
 await showWizardScreen(t,id,screenId,"📝 投稿メニュー\nボタンを選択してください。",extra);
}
async function submitReport(t:Telegram,userId:number,sourceId:number,body:string,
 username?:string):Promise<"delivered"|"queued"|"uncertain"|"missing">{
 const claim=await pool.query<{id:string}>(
  `UPDATE gaybbs_bug_reports SET state='forwarding',body=$2,source_message_id=$3,
     updated_at=NOW() WHERE id=(
      SELECT id FROM gaybbs_bug_reports WHERE owner_user_id=$1 AND state='pending'
       AND body=$2 AND source_message_id=$3
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
   "SELECT id,prompt_message_id FROM gaybbs_bug_reports WHERE owner_user_id=$1 AND state='pending' LIMIT 1",
   [ctx.from.id]);
  if(!pending.rows.length)return next();
  const text=normalizeBugReport(ctx.message.text);
  if(!text){
   // The shared DM contract requires removing even invalid user input.
   // Reuse the existing report screen rather than stacking a separate reply.
   let inputDeleted=true;
   try{await ctx.deleteMessage(ctx.message.message_id);}
   catch{inputDeleted=false;}
   const promptId=Number(pending.rows[0]?.prompt_message_id);
   const prompt=await showWizardScreen(ctx.telegram,ctx.from.id,
    Number.isSafeInteger(promptId)&&promptId>0?promptId:undefined,
    bugReportInputErrorText(inputDeleted),CANCEL);
   await pool.query("UPDATE gaybbs_bug_reports SET prompt_message_id=$2,updated_at=NOW() WHERE owner_user_id=$1 AND state='pending'",
    [ctx.from.id,prompt.messageId]);
   return;
  }
  // Save first; deletion must never destroy the only copy.
  await pool.query(
   "UPDATE gaybbs_bug_reports SET body=$2,source_message_id=$3,updated_at=NOW() WHERE owner_user_id=$1 AND state='pending'",
   [ctx.from.id,text,ctx.message.message_id]);
  // Queue the independent Userbot inbox before attempting operator delivery.
  await pool.query(
   `INSERT INTO gaybbs_bug_report_userbot_delivery(report_id,state)
    SELECT id,'queued' FROM gaybbs_bug_reports
    WHERE owner_user_id=$1 AND state='pending' AND source_message_id=$2
    ON CONFLICT (report_id) DO NOTHING`,[ctx.from.id,ctx.message.message_id]);
  let inputDeleted=true;
  try{await ctx.deleteMessage(ctx.message.message_id);}
  catch{inputDeleted=false;}
  const promptId=Number(pending.rows[0]?.prompt_message_id);
  let promptDeleted=true;
  if(Number.isSafeInteger(promptId)&&promptId>0){
   try{await ctx.telegram.deleteMessage(ctx.from.id,promptId);}
   catch{promptDeleted=false;}
  }else{promptDeleted=false;}
  const result=await submitReport(ctx.telegram,ctx.from.id,ctx.message.message_id,text,ctx.from.username);
  const status=result==="delivered"?"\n\n✅ 運営への通知が完了しました。":
   result==="queued"?"\n\n報告は保存されました。運営への通知は処理待ちです。":
   result==="uncertain"?"\n\n報告は保存されました。運営への通知結果は確認中です。":
   "\n\n受付状態を確認できません。";
  const deletionNote=!inputDeleted||!promptDeleted
   ?"\n\n※削除できなかった以前のメッセージは必要に応じて手動で削除してください。":"";
  // Receipt remains as a separate, readable confirmation. No buttons on it.
  await ctx.telegram.sendMessage(ctx.from.id,bugReportPreview(text)+status+deletionNote);
  // The only actionable keyboard is a fresh posting menu below the receipt.
  await returnMenu(ctx.telegram,ctx.from.id);


 });
}


/** Only reports that were never sent (queued due to missing configuration)
 * may be retried. Uncertain Telegram sends remain parked for reconciliation.
 */
export function startBugReportDeliveryWorker(t:Telegram):()=>void {
 let busy=false;
 const tick=async()=>{
  if(busy)return;
  busy=true;
  try{
   const recipient=recipientId();
   if(recipient)for(let n=0;n<5;n++){
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
   // Send the same report to the independent resident Userbot account.
   // A separate delivery record prevents operator success from implying Userbot success.
   const userbotId=userbotRecipientId();
   if(userbotId){
    for(let n=0;n<5;n++){
     const claimed=await pool.query<{report_id:string;owner_user_id:string;body:string}>(
      `UPDATE gaybbs_bug_report_userbot_delivery d
       SET state='forwarding',updated_at=NOW()
       FROM gaybbs_bug_reports r
       WHERE d.report_id=(
        SELECT report_id FROM gaybbs_bug_report_userbot_delivery
        WHERE state='queued' ORDER BY report_id ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       ) AND r.id=d.report_id AND r.body IS NOT NULL
       RETURNING d.report_id,r.owner_user_id,r.body`);
     if(!claimed.rows.length)break;
     const row=claimed.rows[0]!;
     try{
      const msg=await t.sendMessage(userbotId,
       REPORT_LABEL+"\n報告ID: "+row.report_id+"\nユーザー: "+row.owner_user_id+
       "\n報告内容:\n"+row.body);
      await pool.query(
       "UPDATE gaybbs_bug_report_userbot_delivery SET state='delivered',destination_message_id=$2,updated_at=NOW() WHERE report_id=$1",
       [row.report_id,msg.message_id]);
     }catch{
      await pool.query(
       "UPDATE gaybbs_bug_report_userbot_delivery SET state='uncertain',updated_at=NOW() WHERE report_id=$1",
       [row.report_id]);
      break;
     }
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
