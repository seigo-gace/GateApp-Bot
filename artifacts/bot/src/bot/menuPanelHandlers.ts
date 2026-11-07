/** M1/M2 operations on existing Telegram forums; admin-only and fail-closed.
 * No public menus can be published until runtime release flag and real topic
 * mappings / adopted guidance are verified.
 */
import type {Telegraf} from "telegraf";
import {pool} from "../db/index.js";
import {publishExistingMenuPanel} from "../services/menuPanelPublisher.js";

const GROUPS=new Set([-1003847210571,-1002373696859,-1003770334893]);
async function checked(ctx:any):Promise<{chatId:number;threadId:number;adminId:number}|null>{
 if(ctx.chat?.type!=="supergroup"||!GROUPS.has(ctx.chat.id)||!ctx.from)return null;
 const thread=ctx.message?.message_thread_id;
 if(!Number.isSafeInteger(thread)||thread<=0){
  await ctx.reply("実トピックIDを確認できません。処理しません。");return null;
 }
 const own=await ctx.telegram.getChatMember(ctx.chat.id,ctx.from.id);
 if(own.status!=="creator"&&own.status!=="administrator"){
  await ctx.reply("管理者だけが操作できます。");return null;
 }
 const me=await ctx.telegram.getMe();
 const bot=await ctx.telegram.getChatMember(ctx.chat.id,me.id);
 if(bot.status!=="creator"&&bot.status!=="administrator"){
  await ctx.reply("Botの管理者権限が確認できません。");return null;
 }
 return {chatId:ctx.chat.id,threadId:thread,adminId:ctx.from.id};
}
export function registerMenuPanelHandlers(bot:Telegraf):void{
 // Remove the obsolete Area BBS reply keyboard from the Telegram input area.
 // Does not delete pinned posts or affect other groups. Idempotent via DB ledger.
 bot.command("removeareakeyboard",async ctx=>{
  const where=await checked(ctx);if(!where)return;
  if(where.chatId!==-1003847210571){
   await ctx.reply("エリア’s BBS以外は対象外です。");return;
  }
  const guide=await pool.query(
   "SELECT message_thread_id FROM general_guide_topics WHERE chat_id=$1 AND enabled=TRUE",
   [where.chatId]);
  if(guide.rows.length!==1){
   await ctx.reply("総合案内Topicが未登録です。/bindguide を先に実行してください。");return;
  }
  const done=await pool.query(
   "SELECT message_id FROM area_legacy_reply_keyboard_removals WHERE chat_id=$1",
   [where.chatId]);
  if(done.rows.length){
   await ctx.reply("既に旧キーボード撤去を送信済みです（message_id="+
    done.rows[0].message_id+"）。再送しません。");return;
  }
  try{
   // selective:false addresses all recipients, not just the administrator.
   const sent=await ctx.telegram.sendMessage(where.chatId,
    "📌 旧キーボードメニューは廃止しました。今後は総合案内の投稿ボタンをご利用ください。",{
     message_thread_id:where.threadId,
     reply_markup:{remove_keyboard:true,selective:false},
    });
   await pool.query(
    `INSERT INTO area_legacy_reply_keyboard_removals
      (chat_id,message_thread_id,message_id,verified_by)
     VALUES($1,$2,$3,$4)`,
    [where.chatId,where.threadId,sent.message_id,where.adminId]);
   await ctx.reply("✅ 旧返信キーボードの撤去要求を送信しました（message_id="+sent.message_id+"）。");
  }catch{
   await ctx.reply("キーボード撤去メッセージの送信結果を確認できません。再送前にTelegramで表示を確認してください。");
  }
 });
 bot.command("bindpanel",async ctx=>{
  const where=await checked(ctx);if(!where)return;
  const mode=ctx.message.text.replace(/^\/\S+(?:@\w+)?\s*/,"").trim();
  if(mode!=="posting"&&mode!=="general_guide"){
   await ctx.reply("この既存トピックで /bindpanel posting または /bindpanel general_guide を指定してください。");return;
  }
  if(mode==="general_guide"){
   const guide=await pool.query(
    "SELECT message_thread_id FROM general_guide_topics WHERE chat_id=$1 AND enabled=TRUE",
    [where.chatId]);
   if(guide.rows.length!==1||Number(guide.rows[0].message_thread_id)!==where.threadId){
    await ctx.reply("📌総合案内の実Topicが未確認です。/bindguide で先に確認してください。");return;
   }
  }
  const found=await pool.query(
   `SELECT panel_id,state FROM board_menu_panels
    WHERE chat_id=$1 AND message_thread_id=$2 AND panel_type=$3`,
   [where.chatId,where.threadId,mode]);
  if(found.rows.length&&["publishing","needs_reconcile"].includes(found.rows[0].state)){
   await ctx.reply("既存パネルの送信結果を先に照合する必要があります。二重投稿を防ぐため中断します。");return;
  }
  await pool.query(
   `INSERT INTO board_menu_panels
     (chat_id,message_thread_id,panel_type,state,verified_by,verified_at)
    VALUES($1,$2,$3,'verified',$4,NOW())
    ON CONFLICT(chat_id,message_thread_id,panel_type) DO UPDATE SET
      verified_by=EXCLUDED.verified_by,verified_at=NOW(),
      state=CASE WHEN board_menu_panels.state='published' THEN 'published'
                 ELSE 'verified' END,updated_at=NOW()`,
   [where.chatId,where.threadId,mode,where.adminId]);
  await ctx.reply("✅ 既存トピックのメニュー台帳を接続しました。投稿・固定・既存メッセージ変更はしていません。");
 });
 bot.command("publishpanel",async ctx=>{
  const where=await checked(ctx);if(!where)return;
  try{
   const result=await publishExistingMenuPanel(
    ctx.telegram,where.chatId,where.threadId,where.adminId);
   await ctx.reply(result.updatedExisting?
     "✅ 既存の固定メニューを同じmessage_idで更新しました。":
     "✅ この既存トピックに初回メニューを投稿・固定しました。");
  }catch(e){
   const message=e instanceof Error?e.message:"UNKNOWN";
   await ctx.reply("公開を確認できませんでした："+message+
    "\n成否不明の際は再送せず、台帳とTelegram実物を照合してください。");
  }
 });
}
