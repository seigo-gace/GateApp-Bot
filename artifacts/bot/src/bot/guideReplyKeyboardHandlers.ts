/** Master's 2026-11-08 guide UI: ReplyKeyboardMarkup in the input area,
 * not an InlineKeyboard attached below a post.
 * Fails closed on missing verified destination or an earlier legacy panel.
 */
import type {Telegraf} from "telegraf";
import {pool} from "../db/index.js";
import {APPROVED_GUIDE_ROWS} from "../services/menuPanelRenderer.js";
import {guideMessageUrl} from "./generalGuideHandlers.js";

const GROUPS=[-1003847210571,-1002373696859,-1003770334893] as const;
const LABELS=new Set<string>(APPROVED_GUIDE_ROWS.flat());
const BOARD_TARGETS:Readonly<Record<string,{key:string;chatId:number}>>={
 "全国ボード":{key:"national",chatId:-1003847210571},
 "カテゴリーボード":{key:"category",chatId:-1003770334893},
 "ビデオ/動画":{key:"video",chatId:-1002373696859},
};
async function destination(chatId:number,label:string):Promise<string>{
 const board=BOARD_TARGETS[label];
 if(board){
  const r=await pool.query(
   `SELECT chat_id,message_id FROM topic_board_posts
    WHERE board_key=$1 AND state='published' AND message_id IS NOT NULL`,
   [board.key]);
  if(r.rows.length!==1||Number(r.rows[0].chat_id)!==board.chatId)
   throw new Error("GUIDE_BOARD_UNVERIFIED");
  return guideMessageUrl(board.chatId,Number(r.rows[0].message_id));
 }
 // The other ten labels, including four distinct legal/rule documents,
 // must be independently mapped to their existing approved destinations.
 const r=await pool.query(
  `SELECT destination_url FROM general_guide_links
   WHERE chat_id=$1 AND label=$2 AND enabled=TRUE
     AND verified_by IS NOT NULL AND verified_at IS NOT NULL`,
  [chatId,label]);
 if(r.rows.length!==1)throw new Error("GUIDE_DESTINATION_UNVERIFIED:"+label);
 const url=String(r.rows[0].destination_url);
 if(!/^https:\/\/t\.me\//.test(url))throw new Error("GUIDE_DESTINATION_UNSAFE");
 return url;
}
async function verifiedTopic(chatId:number,threadId:number):Promise<boolean>{
 const r=await pool.query(
  `SELECT message_thread_id FROM general_guide_topics
   WHERE chat_id=$1 AND enabled=TRUE`,[chatId]);
 return r.rows.length===1&&Number(r.rows[0].message_thread_id)===threadId;
}
async function isAdmin(telegram:any,chatId:number,userId:number):Promise<boolean>{
 const m=await telegram.getChatMember(chatId,userId);
 return m.status==="administrator"||m.status==="creator";
}
export function registerGuideReplyKeyboardHandlers(bot:Telegraf):void{
 bot.command("publishguidekeyboard",async ctx=>{
  if(ctx.chat.type!=="supergroup"||!GROUPS.includes(ctx.chat.id as typeof GROUPS[number])||!ctx.from)return;
  const chatId=ctx.chat.id,threadId=(ctx.message as {message_thread_id?:number}).message_thread_id;
  if(!threadId||!await verifiedTopic(chatId,threadId))return;
  try{
   if(process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")
    throw new Error("PUBLIC_MENUS_NOT_RELEASED");
   const self=await ctx.telegram.getMe();
   if(!await isAdmin(ctx.telegram,chatId,ctx.from.id)||
      !await isAdmin(ctx.telegram,chatId,self.id))throw new Error("GUIDE_ADMIN_NOT_VERIFIED");
   // Do not show buttons that have no approved target, including 4 distinct
   // legal/rule entries. No guessed grouping or placeholder.
   for(const label of LABELS)await destination(chatId,label);
   const existing=await pool.query(
    `SELECT panel_id,message_id,state FROM board_menu_panels
      WHERE chat_id=$1 AND message_thread_id=$2 AND panel_type='general_guide'`,
    [chatId,threadId]);
   if(existing.rows.length&&(
      existing.rows[0].message_id!==null||
      !["verified"].includes(String(existing.rows[0].state))
   ))throw new Error("EXISTING_GUIDE_PANEL_RECONCILE_REQUIRED");
   // Lock the existing panel row before Telegram send, exactly once.
   const claim=await pool.query(
    `UPDATE board_menu_panels SET state='publishing',updated_at=NOW()
     WHERE chat_id=$1 AND message_thread_id=$2 AND panel_type='general_guide'
       AND state='verified' AND message_id IS NULL RETURNING panel_id`,
    [chatId,threadId]);
   if(claim.rows.length!==1)throw new Error("GUIDE_PANEL_NOT_BOUND");
   const panelId=String(claim.rows[0].panel_id);
   let messageId:number|null=null;
   try{
    const sent=await ctx.telegram.sendMessage(chatId,
     "📌 総合案内：下のキーボードから項目を選んでください。",{
      message_thread_id:threadId,
      reply_markup:{
       keyboard:APPROVED_GUIDE_ROWS.map(row=>row.map(text=>({text}))),
       resize_keyboard:true,
       is_persistent:true,
      },
     });
    messageId=sent.message_id;
    await pool.query(
     `UPDATE board_menu_panels SET message_id=$2,updated_at=NOW()
      WHERE panel_id=$1 AND state='publishing'`,[panelId,messageId]);
    await ctx.telegram.pinChatMessage(chatId,messageId,{disable_notification:true});
    const ack=await pool.query(
     `UPDATE board_menu_panels SET state='published',pinned=TRUE,revision=revision+1,
      updated_at=NOW() WHERE panel_id=$1 AND state='publishing' RETURNING panel_id`,
     [panelId]);
    if(ack.rowCount!==1)throw new Error("GUIDE_ACK_CONFLICT");
    await ctx.reply("✅ 13ボタンを返信キーボードとして設置しました。");
   }catch(e){
    await pool.query(
     `UPDATE board_menu_panels SET state='needs_reconcile',
     message_id=COALESCE($2,message_id),updated_at=NOW()
     WHERE panel_id=$1 AND state='publishing'`,[panelId,messageId]);
    throw e;
   }
  }catch(e){
   await ctx.reply("総合案内キーボードは設置できません："+(e instanceof Error?e.message:"UNKNOWN")+
    "\n再送せず既存の案内投稿を照合してください。");
  }
 });
 bot.on("text",async(ctx,next)=>{
  if(ctx.chat.type!=="supergroup"||!GROUPS.includes(ctx.chat.id as typeof GROUPS[number]))
   return next();
  const label=ctx.message.text;
  if(!LABELS.has(label))return next();
  const threadId=(ctx.message as {message_thread_id?:number}).message_thread_id;
  if(!threadId||!await verifiedTopic(ctx.chat.id,threadId))return next();
  // Only act on the published guide keyboard for this actual Topic.
  const published=await pool.query(
   `SELECT message_id FROM board_menu_panels
    WHERE chat_id=$1 AND message_thread_id=$2 AND panel_type='general_guide'
      AND state='published' AND message_id IS NOT NULL`,
    [ctx.chat.id,threadId]);
  if(published.rows.length!==1)return next();
  try{
   const url=await destination(ctx.chat.id,label);
   await ctx.reply(label+"はこちらから開けます。\n"+url);
  }catch{
   await ctx.reply("この項目の接続先はまだ確認できていません。");
  }
  try{await ctx.telegram.deleteMessage(ctx.chat.id,ctx.message.message_id);}catch{
   // Deletion is best effort. Do not mark it as deleted on failure.
  }
 });
}
