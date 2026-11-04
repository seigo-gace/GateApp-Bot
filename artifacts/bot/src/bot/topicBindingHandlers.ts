import type { Telegraf } from "telegraf";
import { pool } from "../db/index.js";
import type { BoardKey,PostPurpose } from "../services/topicRouting.js";

/** The only candidate board identities. Incoming actual chat.id is checked,
 * and no URL suffix is treated as a Telegram message_thread_id.
 */
const BOARDS: Readonly<Record<string,BoardKey>>={
 "-1003847210571":"area_bbs",
 "-1002373696859":"video_chat",
 "-1003770334893":"gay_board",
};
const COMMANDS: Readonly<Record<string,PostPurpose>>={
 bindprofile:"profile",bindroom:"room",bindannounce:"announcement",
};
export function registerTopicBindingHandlers(bot:Telegraf):void{
 for(const [command,purpose] of Object.entries(COMMANDS)){
  bot.command(command,async ctx=>{
   if(ctx.chat.type!=="supergroup"||!ctx.from)return;
   const board=BOARDS[String(ctx.chat.id)];
   const thread=(ctx.message as {message_thread_id?:number}).message_thread_id;
   if(!board||!Number.isSafeInteger(thread)||!thread||thread<=0){
     await ctx.reply("この既存トピックを確認できません。登録を拒否しました。");
     return;
   }
   const member=await ctx.telegram.getChatMember(ctx.chat.id,ctx.from.id);
   if(member.status!=="administrator"&&member.status!=="creator"){
     await ctx.reply("トピック接続はグループ管理者だけが行えます。");
     return;
   }
   const botInfo=await ctx.telegram.getMe();
   const botMember=await ctx.telegram.getChatMember(ctx.chat.id,botInfo.id);
   if(botMember.status!=="administrator"&&botMember.status!=="creator"){
     await ctx.reply("Botに管理者権限がないため、登録を拒否しました。");
     return;
   }
   // The human supplies the current topic label; Telegram Bot API does not
   // provide a general getForumTopic title endpoint.
   const title=ctx.message.text.replace(/^\/\S+(?:@\w+)?\s*/,"").trim();
   if(!title||title.length>100){
     await ctx.reply("トピック名を付けてください。例：/bindprofile みんなのプロフ");
     return;
   }
   await pool.query(
    `INSERT INTO posting_topics
      (board_key,purpose,chat_id,message_thread_id,title,verified_by,verified_at,enabled)
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),TRUE)
      ON CONFLICT (board_key,purpose,chat_id,message_thread_id)
      DO UPDATE SET title=EXCLUDED.title,verified_by=EXCLUDED.verified_by,
        verified_at=NOW(),enabled=TRUE`,
    [board,purpose,ctx.chat.id,thread,title,ctx.from.id]
   );
   await ctx.reply("✅ 投稿先として接続しました："+title+"（"+purpose+"）");
  });
 }
}
