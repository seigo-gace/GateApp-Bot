/** Dedicated @GayBBS_bot user-facing runtime. NOT the existing admin/Gate bot. */
import https from "node:https";
import { BOT_TOKEN } from "./config/env.js";
import { Telegraf } from "telegraf";
import { registerProfileHandlers, startProfileEditor } from "./bot/profileHandlers.js";
import {registerProfileViewerHandlers,startProfileViewer} from "./bot/profileViewerHandlers.js";
import {registerProfilePostManagement} from "./bot/profilePublicationHandlers.js";
import {parseProfileViewerPayload} from "./services/profilePublicView.js";
import { registerPostingHandlers, startRoomEditor, startAnnouncementEditor, startLinkEditor } from "./bot/postingHandlers.js";
import {registerCompactRecruitmentHandlers,startCompactRecruitmentEditor} from "./bot/recruitmentHandlers.js";
import { registerTopicBindingHandlers } from "./bot/topicBindingHandlers.js";
import { registerGeneralGuideHandlers } from "./bot/generalGuideHandlers.js";
import { registerMenuPanelHandlers } from "./bot/menuPanelHandlers.js";
import {registerSearchHandlers,startSearchEditor} from "./bot/searchHandlers.js";
import {registerOperationHelpHandlers,startOperationHelp} from "./bot/operationHelpHandlers.js";
import {registerApplicationHandlers,startApplicationEditor} from "./bot/applicationHandlers.js";
import {registerRoomHandlers} from "./bot/roomHandlers.js";
import { runMigrations } from "./db/migrate.js";
import { closePool } from "./db/index.js";
import {startGayBbsWorkers} from "./services/gaybbsWorkers.js";
import { activateMenuOrigin } from "./services/menuOriginRepository.js";
import {startGayBbsAdmission,registerGayBbsApprovalHandlers} from "./modules/gaybbsApproval/handlers.js";
import {suppressAreaCommandMenu,GAY_BOARD_CHAT_ID,suppressGroupCommandMenu} from "./services/areaMenuSuppression.js";
import {handleOnlineGateStart,registerOnlineGateCheckHandler} from "./services/onlineGateAccess.js";
import {pool} from "./db/index.js";

async function main():Promise<void>{
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL_REQUIRED");
 const bot=new Telegraf(BOT_TOKEN,{
  telegram:{agent:new https.Agent({keepAlive:true,family:4})},
 });
 const me=await bot.telegram.getMe();
 if(me.username?.toLowerCase()!=="gaybbs_bot"||me.id===8086265383)
  throw new Error("GAYBBS_BOT_IDENTITY_MISMATCH");
 await runMigrations();
 bot.start(async ctx=>{
  if(ctx.chat.type!=="private")return;
  if(ctx.startPayload?.startsWith("online_")){
   if(await handleOnlineGateStart(ctx))return;
  }
  if(ctx.startPayload?.startsWith("gate_")){
   await startGayBbsAdmission(ctx,ctx.startPayload);
   return;
  }
  if(parseProfileViewerPayload(ctx.startPayload||"")){
   await startProfileViewer(ctx,ctx.startPayload);
   return;
  }
  if(ctx.startPayload==="search"){
   await startSearchEditor(ctx.telegram,ctx.from.id);
   return;
  }
  if(ctx.startPayload?.startsWith("a_")){
   await startApplicationEditor(ctx,ctx.startPayload);
   return;
  }
  if(ctx.startPayload && /^(?:m|r)_/.test(ctx.startPayload)){
   try{
    const origin=await activateMenuOrigin(ctx.from.id,ctx.startPayload);
    if(origin.feature==="profile"){
     await startProfileEditor(ctx);
    }else if(origin.feature==="room"){
     await startRoomEditor(ctx.telegram,ctx.from.id);
    }else if(origin.feature==="announcement"){
     if(ctx.startPayload.startsWith("r_"))
      await startCompactRecruitmentEditor(ctx.telegram,ctx.from.id);
     else await startAnnouncementEditor(ctx.telegram,ctx.from.id);
    }else if(origin.feature==="link"){
     await startLinkEditor(ctx.telegram,ctx.from.id);
    }else if(origin.feature==="search"){
     await startSearchEditor(ctx.telegram,ctx.from.id);
    }else if(origin.feature==="help"){
     await startOperationHelp(ctx.telegram,ctx.from.id);
    }else{
     await ctx.reply("この機能の公開準備が完了していません。");
    }
   }catch{
    await ctx.reply("この投稿メニューのリンクは期限切れ、または未登録です。元のトピックの新しい固定メニューを利用してください。");
   }
   return;
  }
  await ctx.reply("GayBBS 共通メニュー\n/profile — プロフィール作成\n/publishprofile — プロフィール公開・更新\n/myprofileposts — マイ投稿管理\n/room — ROOM作成\n/recruit — 相手募集\n/announce — 告知・予告・募集作成\n/link — リンクボタン作成\n/search — 検索/フィルター\n/help — 操作説明\n/myapplications — 自分の応募履歴\n/applications — 募集主の応募管理\n/myrooms — 自分のROOM管理\n\n総合案内は所属グループの 📌総合案内トピックにある /guide から確認できます。公開先は管理者が確認したトピックのみです。");
 });
 registerProfileHandlers(bot);
 registerProfileViewerHandlers(bot);
 registerProfilePostManagement(bot);
 registerCompactRecruitmentHandlers(bot);
 registerPostingHandlers(bot);
 registerTopicBindingHandlers(bot);
 registerGeneralGuideHandlers(bot);
 registerMenuPanelHandlers(bot);
 registerSearchHandlers(bot);
 registerOperationHelpHandlers(bot);
 registerApplicationHandlers(bot);
 registerRoomHandlers(bot);
 registerGayBbsApprovalHandlers(bot);
 registerOnlineGateCheckHandler(bot);
 try{
  const areaMenu=await suppressAreaCommandMenu(bot.telegram);
  await pool.query(
    `INSERT INTO area_command_menu_suppressions
      (chat_id,scopes_cleared,legacy_bot_id,legacy_bot_status,legacy_bot_removed,verified_by)
     VALUES ($1,$2,$3,$4,$5,0)
     ON CONFLICT (chat_id) DO UPDATE SET
      scopes_cleared=EXCLUDED.scopes_cleared,
      legacy_bot_status=EXCLUDED.legacy_bot_status,
      legacy_bot_removed=EXCLUDED.legacy_bot_removed OR area_command_menu_suppressions.legacy_bot_removed,
      suppressed_at=NOW()`,
    [areaMenu.chatId,areaMenu.scopesCleared.join(","),areaMenu.legacyBotId,
     areaMenu.legacyBotStatus,areaMenu.legacyBotRemoved]);
  console.log("GAYBBS_AREA_MENU_SUPPRESSED chat="+areaMenu.chatId+
    " legacy_status="+areaMenu.legacyBotStatus);
 }catch(error){
  console.error("GAYBBS_AREA_MENU_SUPPRESSION_FAILED",
    error instanceof Error?error.message:"unknown");
 }
 try{
  const gayScopes=await suppressGroupCommandMenu(bot.telegram,GAY_BOARD_CHAT_ID);
  await pool.query(
    `INSERT INTO area_command_menu_suppressions
      (chat_id,scopes_cleared,legacy_bot_id,legacy_bot_status,legacy_bot_removed,verified_by)
     VALUES ($1,$2,0,'n/a',FALSE,0)
     ON CONFLICT (chat_id) DO UPDATE SET
      scopes_cleared=EXCLUDED.scopes_cleared,
      suppressed_at=NOW()`,
    [GAY_BOARD_CHAT_ID,gayScopes.join(",")]);
  console.log("GAYBBS_GAY_BOARD_MENU_SUPPRESSED chat="+GAY_BOARD_CHAT_ID);
 }catch(error){
  console.error("GAYBBS_GAY_BOARD_MENU_SUPPRESSION_FAILED",
    error instanceof Error?error.message:"unknown");
 }
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
