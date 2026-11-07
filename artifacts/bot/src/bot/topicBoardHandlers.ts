/** Telegram-native board publication. One canonical bot-owned post per
 * approved board. No parallel "guide" document, topic or additional bot.
 * State is persisted in the existing GayBBS PostgreSQL database.
 */
import type {Telegraf} from "telegraf";
import {pool} from "../db/index.js";
import {createTelegramDispatcher} from "../services/telegramDispatcher.js";
import {
 AREA_BLOCKS,renderAreaBlock,renderNationalBoard,renderTopicBoard,
} from "../services/topicBoardContent.js";
type BoardKey="video"|"category"|"national"|string;
const CHAT_AREA=-1003847210571,CHAT_VIDEO=-1002373696859,CHAT_GAY=-1003770334893;
function destination(key:string):number {
 if(key==="video")return CHAT_VIDEO;
 if(key==="category")return CHAT_GAY;
 if(key==="national"||key.startsWith("block:")&&AREA_BLOCKS.some(x=>x.label===key.slice(6)))
  return CHAT_AREA;
 throw new Error("BOARD_KEY_UNKNOWN");
}
function actionArg(message:string):string {
 return message.replace(/^\/\S+(?:@\w+)?\s*/,"").trim();
}
function areaChild(block:string,child:string):boolean {
 return AREA_BLOCKS.some(b=>b.label===block&&b.children.some(c=>c.label===child));
}
function areaLink(url:string):boolean {
 return /^https:\/\/t\.me\/c\/3847210571\/[1-9][0-9]*$/.test(url);
}
async function adminContext(ctx:any):Promise<{chatId:number;threadId:number;adminId:number}|null>{
 if(ctx.chat?.type!=="supergroup"||!ctx.from)return null;
 const chatId=ctx.chat.id as number;
 if(![CHAT_AREA,CHAT_VIDEO,CHAT_GAY].includes(chatId))return null;
 const threadId=ctx.message?.message_thread_id;
 if(!Number.isSafeInteger(threadId)||threadId<=0){
  await ctx.reply("既存Topicの実message_thread_idが取得できません。変更しません。");
  return null;
 }
 const member=await ctx.telegram.getChatMember(chatId,ctx.from.id);
 if(!["creator","administrator"].includes(member.status)){
  await ctx.reply("この操作は管理者専用です。");return null;
 }
 const self=await ctx.telegram.getMe();
 const botMember=await ctx.telegram.getChatMember(chatId,self.id);
 if(!["creator","administrator"].includes(botMember.status)){
  await ctx.reply("Botの管理者権限が確認できません。");return null;
 }
 return {chatId,threadId,adminId:ctx.from.id};
}
async function boardText(key:string):Promise<string>{
 if(key==="video"||key==="category")return renderTopicBoard(key);
 if(key==="national")return renderNationalBoard();
 const block=key.slice(6);
 const found=AREA_BLOCKS.find(x=>x.label===block);
 if(!found)throw new Error("BOARD_KEY_UNKNOWN");
 const rows=await pool.query(
  "SELECT area_name,target_url FROM topic_board_area_links WHERE block_name=$1",
  [block]);
 const resolved:Record<string,string>={};
 for(const row of rows.rows){
  if(!areaChild(block,String(row.area_name))||!areaLink(String(row.target_url)))
   throw new Error("AREA_LINK_INVALID");
  resolved[`${block}/${String(row.area_name)}`]=String(row.target_url);
 }
 return renderAreaBlock(block,resolved);
}
export function registerTopicBoardHandlers(bot:Telegraf):void{
 bot.command("bindtopicboard",async ctx=>{
  const at=await adminContext(ctx);if(!at)return;
  const key=actionArg(ctx.message.text);
  try{
   if(destination(key)!==at.chatId)throw new Error("BOARD_OWNER_MISMATCH");
   const r=await pool.query(
    `INSERT INTO topic_board_posts(board_key,chat_id,message_thread_id,verified_by)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(board_key) DO UPDATE SET
      verified_by=EXCLUDED.verified_by,verified_at=NOW(),updated_at=NOW()
     WHERE topic_board_posts.chat_id=EXCLUDED.chat_id
       AND topic_board_posts.message_thread_id=EXCLUDED.message_thread_id
       AND topic_board_posts.state IN ('verified','published')
     RETURNING board_key`,
    [key,at.chatId,at.threadId,at.adminId]);
   if(r.rowCount!==1)throw new Error("BOARD_ALREADY_BOUND_OR_RECONCILE_REQUIRED");
   await ctx.reply("✅ 既存Topicの実IDを案内ボードへ紐付けました。投稿はしていません。");
  }catch(e){await ctx.reply("接続を拒否しました："+(e instanceof Error?e.message:"UNKNOWN"));}
 });
 // Adopt an already-existing Bot-authored board post instead of creating
 // a duplicate. Replies provide the real message_id and thread_id.
 bot.command("adopttopicboard",async ctx=>{
  const at=await adminContext(ctx);if(!at)return;
  const key=actionArg(ctx.message.text);
  const reply=ctx.message.reply_to_message;
  try{
   if(destination(key)!==at.chatId||!reply)throw new Error("BOARD_ADOPTION_TARGET_MISSING");
   const sameThread=(reply as {message_thread_id?:number}).message_thread_id===at.threadId;
   const self=await ctx.telegram.getMe();
   if(!sameThread||reply.from?.id!==self.id)throw new Error("BOARD_EXISTING_POST_NOT_BOT_OWNED");
   const text="text" in reply&&typeof reply.text==="string"?reply.text:"";
   const expected=key==="national"?"全国エリアボード":
    key==="video"?"ビデオChatの掲示板":
    key==="category"?"ゲイのための掲示板":key.slice(6);
   if(!text.includes(expected))throw new Error("BOARD_EXISTING_POST_TITLE_MISMATCH");
   const found=await pool.query(
    `INSERT INTO topic_board_posts(board_key,chat_id,message_thread_id,message_id,state,verified_by)
     VALUES($1,$2,$3,$4,'published',$5)
     ON CONFLICT(board_key) DO UPDATE SET
      message_id=EXCLUDED.message_id,state='published',
      verified_by=EXCLUDED.verified_by,verified_at=NOW(),updated_at=NOW()
     WHERE topic_board_posts.chat_id=EXCLUDED.chat_id
       AND topic_board_posts.message_thread_id=EXCLUDED.message_thread_id
       AND topic_board_posts.state='verified'
       AND topic_board_posts.message_id IS NULL
     RETURNING board_key`,[key,at.chatId,at.threadId,reply.message_id,at.adminId]);
   if(found.rowCount!==1)throw new Error("BOARD_ALREADY_PUBLISHED_OR_CONFLICT");
   await ctx.reply("✅ 既存のBot投稿を登録しました。新規投稿や本文変更はしていません。");
  }catch(e){await ctx.reply("既存投稿の採用を拒否しました："+(e instanceof Error?e.message:"UNKNOWN"));}
 });
 // Missing historical child links are recorded only after a current administrator
 // explicitly supplies the real existing Telegram destination, never guessed.
 bot.command("setboardarealink",async ctx=>{
  const at=await adminContext(ctx);if(!at||at.chatId!==CHAT_AREA)return;
  const args=actionArg(ctx.message.text).split(/\s+/);
  const [block,child,url]=args;
  if(!block||!child||!url||!areaChild(block,child)||!areaLink(url)){
   await ctx.reply("形式: /setboardarealink 地域ブロック エリア名 https://t.me/c/3847210571/投稿番号\n実際のリンクを確認して指定してください。");
   return;
  }
  const row=await pool.query(
   `INSERT INTO topic_board_area_links(block_name,area_name,target_url,verified_by)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(block_name,area_name) DO UPDATE SET
      target_url=EXCLUDED.target_url,verified_by=EXCLUDED.verified_by,
      verified_at=NOW()
    RETURNING block_name`,[block,child,url,at.adminId]);
  if(row.rowCount===1)await ctx.reply("✅ 既存エリアへのリンクを登録しました。案内投稿はまだ更新していません。");
 });
 bot.command("publishtopicboard",async ctx=>{
  const at=await adminContext(ctx);if(!at)return;
  const key=actionArg(ctx.message.text);
  try{
   if(process.env.GAYBBS_TOPIC_BOARD_RELEASE!=="enabled")
    throw new Error("TOPIC_BOARD_RELEASE_DISABLED");
   if(destination(key)!==at.chatId)throw new Error("BOARD_OWNER_MISMATCH");
   const text=await boardText(key); // Resolve EVERY required link before claiming.
   const claimed=await pool.query(
    `UPDATE topic_board_posts SET state='publishing',updated_at=NOW()
     WHERE board_key=$1 AND chat_id=$2 AND message_thread_id=$3
       AND state IN ('verified','published') RETURNING message_id,state`,
    [key,at.chatId,at.threadId]);
   if(claimed.rows.length!==1)throw new Error("BOARD_NOT_VERIFIED_OR_RECONCILE_REQUIRED");
   let messageId=claimed.rows[0].message_id===null?null:Number(claimed.rows[0].message_id);
   const existing=messageId!==null;
   let deliveryStarted=false;
   try{
    const dispatch=createTelegramDispatcher(ctx.telegram);
    const target={chatId:at.chatId,threadId:at.threadId};
    deliveryStarted=true;
    if(messageId!==null){
     await dispatch.revise(target,messageId,{text,parseMode:"HTML"});
    }else{
     messageId=await dispatch.publish(target,{text,parseMode:"HTML"});
    }
    const ack=await pool.query(
     `UPDATE topic_board_posts SET state='published',message_id=$2,updated_at=NOW()
      WHERE board_key=$1 AND state='publishing' RETURNING board_key`,[key,messageId]);
    if(ack.rows.length!==1)throw new Error("BOARD_ACK_CONFLICT");
    await ctx.reply(existing?
     "✅ 既存案内ボードを同じメッセージIDで更新しました。":
     "✅ 既存Topicに案内ボードを初回投稿しました。");
   }catch(e){
    await pool.query(
     `UPDATE topic_board_posts SET state=$3,message_id=COALESCE($2,message_id),
      updated_at=NOW() WHERE board_key=$1 AND state='publishing'`,
     [key,messageId,deliveryStarted?"needs_reconcile":existing?"published":"verified"]);
    throw e;
   }
  }catch(e){
   await ctx.reply("案内ボードの反映を確認できません："+(e instanceof Error?e.message:"UNKNOWN")+
    "\n送信結果不明時は再送せず既存の投稿台帳と現物を照合してください。");
  }
 });
}
