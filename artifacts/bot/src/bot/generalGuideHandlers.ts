/** General guidance is part of the SAME GayBBS bot and shared topic registry.
 * Never posts a legal draft or overwrites an existing Telegram pinned message.
 * Guides are persistent messages (not temporary replies); links only to verified IDs.
 */
import { Markup, type Telegraf } from "telegraf";
import { pool } from "../db/index.js";
import { guideMessageUrl } from "../services/guideMessageUrl.js";
export { guideMessageUrl } from "../services/guideMessageUrl.js";

export const GUIDE_TYPES = ["terms","rules","safety","privacy","howto","search","menu"] as const;
export type GuideType = typeof GUIDE_TYPES[number];
const GROUPS = new Set([-1003847210571,-1002373696859,-1003770334893]);
const TITLES:Record<GuideType,string>={
 terms:"利用規約",rules:"グループルール",safety:"安全ガイドライン",privacy:"プライバシー",
 howto:"使い方・操作説明",search:"検索",menu:"案内メニュー",
};
export function guideMenuButtons(
 records:ReadonlyArray<{document_type:string;message_id:number|null;status:string}>,
 chatId:number
):Array<Array<{text:string;url:string}>>{
 return records.filter(r=>r.status==="published"&&r.message_id!==null&&
  GUIDE_TYPES.includes(r.document_type as GuideType)).map(r=>[{
   text:TITLES[r.document_type as GuideType],
   url:guideMessageUrl(chatId,r.message_id!),
 }]);
}
async function isAdmin(bot:Telegraf,chatId:number,userId:number):Promise<boolean>{
 const m=await bot.telegram.getChatMember(chatId,userId);
 return m.status==="creator"||m.status==="administrator";
}
export function registerGeneralGuideHandlers(bot:Telegraf):void{
 // Run this only inside the already existing guide topic, by a group administrator.
 // The real thread ID comes from the Telegram message update, NEVER a t.me/c URL.
 bot.command("bindguide",async ctx=>{
  if(ctx.chat.type!=="supergroup"||!GROUPS.has(ctx.chat.id)||!ctx.from)return;
  const thread=(ctx.message as {message_thread_id?:number}).message_thread_id;
  if(!Number.isSafeInteger(thread)||!thread||thread<=0){
   await ctx.reply("総合案内の実Topic IDを取得できません。登録しません。");return;
  }
  if(!await isAdmin(bot,ctx.chat.id,ctx.from.id)){
   await ctx.reply("管理者のみ登録できます。");return;
  }
  const self=await ctx.telegram.getMe();
  if(!await isAdmin(bot,ctx.chat.id,self.id)){
   await ctx.reply("Botの管理権限が未確認です。");return;
  }
  await pool.query(
   `INSERT INTO general_guide_topics(chat_id,message_thread_id,verified_by,enabled)
    VALUES($1,$2,$3,TRUE)
    ON CONFLICT(chat_id) DO UPDATE SET
      message_thread_id=EXCLUDED.message_thread_id,verified_by=EXCLUDED.verified_by,
      verified_at=NOW(),enabled=TRUE`,
   [ctx.chat.id,thread,ctx.from.id]
  );
  await ctx.reply("✅ この総合案内Topicを接続しました。既存の固定投稿は変更していません。");
 });
 // Link existing Telegram posts safely: admin REPLIES to the existing document message.
 // No guessing post IDs and no unapproved legal text publication.
 bot.command("bindguidemessage",async ctx=>{
  if(ctx.chat.type!=="supergroup"||!GROUPS.has(ctx.chat.id)||!ctx.from)return;
  if(!await isAdmin(bot,ctx.chat.id,ctx.from.id))return;
  const token=ctx.message.text.split(/\s+/)[1] as GuideType|undefined;
  const reply=ctx.message.reply_to_message;
  const thread=(ctx.message as {message_thread_id?:number}).message_thread_id;
  if(!token||!GUIDE_TYPES.includes(token)||!reply||!thread||
     (reply as {message_thread_id?:number}).message_thread_id!==thread){
   await ctx.reply("既存の総合案内の文書投稿へ返信し、/bindguidemessage terms|rules|safety|privacy|howto|search|menu を指定してください。");
   return;
  }
  const verified=await pool.query(
   "SELECT message_thread_id FROM general_guide_topics WHERE chat_id=$1 AND enabled=TRUE",
   [ctx.chat.id]);
  if(verified.rows.length!==1||Number(verified.rows[0].message_thread_id)!==thread){
   await ctx.reply("総合案内Topicが未確認です。");return;
  }
  await pool.query(
   `INSERT INTO general_guide_documents
     (chat_id,document_type,message_id,version,approved_by,approved_at,synced_at,status)
    VALUES($1,$2,$3,'existing', $4,NOW(),NOW(),'published')
    ON CONFLICT(chat_id,document_type) DO UPDATE SET
     message_id=EXCLUDED.message_id,version='existing',
     approved_by=EXCLUDED.approved_by,approved_at=NOW(),synced_at=NOW(),
     status='published',updated_at=NOW()`,
   [ctx.chat.id,token,reply.message_id,ctx.from.id]
  );
  await ctx.reply("✅ 既存の常設文書IDをリンク台帳に接続しました。本文は編集していません。");
 });
 bot.command("guide",async ctx=>{
  if(ctx.chat.type!=="supergroup"||!GROUPS.has(ctx.chat.id))return;
  const t=await pool.query(
   "SELECT message_thread_id FROM general_guide_topics WHERE chat_id=$1 AND enabled=TRUE",
   [ctx.chat.id]);
  if(t.rows.length!==1)return;
  const thread=(ctx.message as {message_thread_id?:number}).message_thread_id;
  if(thread!==Number(t.rows[0].message_thread_id))return;
  const r=await pool.query(
   "SELECT document_type,message_id,status FROM general_guide_documents WHERE chat_id=$1",
   [ctx.chat.id]);
  const buttons=guideMenuButtons(r.rows.map(row=>({
   document_type:String(row.document_type),
   message_id:row.message_id===null?null:Number(row.message_id),
   status:String(row.status),
  })),ctx.chat.id);
  if(!buttons.length){
   await ctx.reply("案内文書への接続がまだ確認されていません。");return;
  }
  await ctx.reply("📌 総合案内：各項目から常設投稿へ移動できます。",
   Markup.inlineKeyboard(buttons.map(row=>row.map(x=>Markup.button.url(x.text,x.url)))));
 });
}
