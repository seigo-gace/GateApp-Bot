/** Dedicated @GayBBS_bot user-facing runtime. NOT the existing admin/Gate bot. */
import { BOT_TOKEN } from "./config/env.js";
import { Telegraf } from "telegraf";
import { registerProfileHandlers, startProfileEditor } from "./bot/profileHandlers.js";
import {registerProfileViewerHandlers,startProfileViewer} from "./bot/profileViewerHandlers.js";
import {registerProfilePostManagement} from "./bot/profilePublicationHandlers.js";
import {parseProfileViewerPayload} from "./services/profilePublicView.js";
import { registerPostingHandlers, startRoomEditor, startAnnouncementEditor, startLinkEditor } from "./bot/postingHandlers.js";
import { registerTopicBindingHandlers } from "./bot/topicBindingHandlers.js";
import { registerGeneralGuideHandlers } from "./bot/generalGuideHandlers.js";
import { registerMenuPanelHandlers } from "./bot/menuPanelHandlers.js";
import {registerApplicationHandlers,startApplicationEditor} from "./bot/applicationHandlers.js";
import {registerRoomHandlers} from "./bot/roomHandlers.js";
import { runMigrations } from "./db/migrate.js";
import { closePool } from "./db/index.js";
import {startGayBbsWorkers} from "./services/gaybbsWorkers.js";
import { activateMenuOrigin } from "./services/menuOriginRepository.js";
import {startGayBbsAdmission,registerGayBbsApprovalHandlers} from "./modules/gaybbsApproval/handlers.js";

async function main():Promise<void>{
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL_REQUIRED");
 const bot=new Telegraf(BOT_TOKEN);
 const me=await bot.telegram.getMe();
 if(me.username?.toLowerCase()!=="gaybbs_bot"||me.id===8086265383)
  throw new Error("GAYBBS_BOT_IDENTITY_MISMATCH");
 await runMigrations();
 bot.start(async ctx=>{
  if(ctx.chat.type!=="private")return;
  if(ctx.startPayload?.startsWith("gate_")){
   await startGayBbsAdmission(ctx,ctx.startPayload);
   return;
  }
  if(parseProfileViewerPayload(ctx.startPayload||"")){
   await startProfileViewer(ctx,ctx.startPayload);
   return;
  }
  if(ctx.startPayload?.startsWith("a_")){
   await startApplicationEditor(ctx,ctx.startPayload);
   return;
  }
  if(ctx.startPayload?.startsWith("m_")){
   try{
    const origin=await activateMenuOrigin(ctx.from.id,ctx.startPayload);
    // N14 requires the Topic menu button itself to open the shared DM editor,
    // not another instruction requiring a second /command.
    if(origin.feature==="profile"){
     await startProfileEditor(ctx);
    }else if(origin.feature==="room"){
     await startRoomEditor(ctx.telegram,ctx.from.id);
    }else if(origin.feature==="announcement"){
     await startAnnouncementEditor(ctx.telegram,ctx.from.id);
    }else if(origin.feature==="link"){
     await startLinkEditor(ctx.telegram,ctx.from.id);
    }else{
     await ctx.reply("この機能の公開準備が完了していません。");
    }
   }catch{
    await ctx.reply("この投稿メニューのリンクは期限切れ、または未登録です。元のトピックの新しい固定メニューを利用してください。");
   }
   return;
  }
  await ctx.reply("GayBBS 共通メニュー\n/profile — プロフィール作成\n/publishprofile — プロフィール公開・更新\n/myprofileposts — マイ投稿管理\n/room — ROOM作成\n/announce — 告知・予告・募集作成\n/link — リンクボタン作成\n/myapplications — 自分の応募履歴\n/applications — 募集主の応募管理\n/myrooms — 自分のROOM管理\n\n総合案内は所属グループの 📌総合案内トピックにある /guide から確認できます。公開先は管理者が確認したトピックのみです。");
 });
 registerProfileHandlers(bot);
 registerProfileViewerHandlers(bot);
 registerProfilePostManagement(bot);
 registerPostingHandlers(bot);
 registerTopicBindingHandlers(bot);
 registerGeneralGuideHandlers(bot);
 registerMenuPanelHandlers(bot);
 registerApplicationHandlers(bot);
 registerRoomHandlers(bot);
 registerGayBbsApprovalHandlers(bot);
 bot.catch((error,ctx)=>{
  console.error("[GAYBBS_ERROR]",ctx.updateType,
    error instanceof Error?error.name:"unknown");
 });
 await bot.launch({
  dropPendingUpdates:false,
  allowedUpdates:["message","callback_query","chat_join_request"],
 });
 console.log("GAYBBS_BOT_READY bot_id="+me.id);
 const stopWorkers=startGayBbsWorkers(bot.telegram);
 const stop=async(signal:string)=>{
  stopWorkers();
  bot.stop(signal);
  await closePool();
 };
 process.once("SIGINT",()=>{void stop("SIGINT")});
 process.once("SIGTERM",()=>{void stop("SIGTERM")});
}
main().catch(error=>{
 console.error("GAYBBS_STARTUP_FAILED",error instanceof Error?error.message:"unknown");
 process.exitCode=1;
});
