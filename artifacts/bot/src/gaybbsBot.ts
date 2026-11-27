/** Dedicated @GayBBS_bot user-facing runtime. NOT the existing admin/Gate bot. */
import https from "node:https";
import { BOT_TOKEN } from "./config/env.js";
import {installPollingTransport} from "./services/telegramPollingTransport.js";
import {ActorQueue,boundTelegramCalls} from "./services/runtimeReliability.js";
import { Markup, Telegraf } from "telegraf";
import { registerProfileHandlers } from "./bot/profileHandlers.js";
import {registerStartlessNavigationHandlers} from "./bot/startlessNavigationHandlers.js";
import {registerCompactProfileHandlers,startCompactProfileEditor,returnFromCompactAppearance} from "./bot/profileCompactHandlers.js";
import {registerProfileViewerHandlers,startProfileViewer} from "./bot/profileViewerHandlers.js";
import {registerProfilePostManagement} from "./bot/profilePublicationHandlers.js";
import {parseProfileViewerPayload} from "./services/profilePublicView.js";
import { registerPostingHandlers, startRoomEditor, startAnnouncementEditor, startLinkEditor } from "./bot/postingHandlers.js";
import {registerCompactRecruitmentHandlers,startCompactRecruitmentEditor} from "./bot/recruitmentHandlers.js";
import {registerLinkInlineHandlers} from "./bot/linkInlineHandlers.js";
import {registerPostingMenuUtilityHandlers,startPostingMenuUtility} from "./bot/postingMenuUtilityHandlers.js";
import { registerTopicBindingHandlers } from "./bot/topicBindingHandlers.js";
import { registerGeneralGuideHandlers } from "./bot/generalGuideHandlers.js";
import { registerMenuPanelHandlers } from "./bot/menuPanelHandlers.js";
import { registerTopicBoardHandlers } from "./bot/topicBoardHandlers.js";
import {registerSearchHandlers,startSearchEditor} from "./bot/searchHandlers.js";
import {registerOperationHelpHandlers,startOperationHelp} from "./bot/operationHelpHandlers.js";
import {registerApplicationHandlers,startApplicationEditor} from "./bot/applicationHandlers.js";
import {registerRoomHandlers} from "./bot/roomHandlers.js";
import {registerNoticeInteractionHandlers,isNoticeApplicationLink,startNoticeApplication} from "./bot/noticeInteractions.js";
import {resolveRoomJoinLink,roomJoinDenialReason} from "./services/roomJoinLinks.js";
import { runMigrations } from "./db/migrate.js";
import { closePool } from "./db/index.js";
import {startGayBbsWorkers} from "./services/gaybbsWorkers.js";
import { activateMenuOrigin } from "./services/menuOriginRepository.js";
import {startGayBbsAdmission,registerGayBbsApprovalHandlers} from "./modules/gaybbsApproval/handlers.js";
import {suppressAreaCommandMenu,GAY_BOARD_CHAT_ID,VIDEO_CHAT_CHAT_ID,
 suppressBotDmCommandMenu,suppressGroupCommandMenu} from "./services/areaMenuSuppression.js";
import {handleOnlineGateStart,registerOnlineGateCheckHandler} from "./services/onlineGateAccess.js";
import {pool,configureGaybbsDatabaseWaits} from "./db/index.js";
import {registerBugReportHandlers,startBugReport,startBugReportDeliveryWorker} from "./bot/bugReportHandlers.js";
import {startTumblrBridge} from "./services/tumblrBridgeServer.js";
import {
  BARE_START_POSTING_TEXT,
  bareStartPostingExtra,
  defaultBareStartChatId,
} from "./services/dmBareStartPostingMenu.js";
import { DM_POSTING_MENU_SCREEN_TEXT } from "./services/dmPostingMenuRestore.js";
import { currentMenuOrigin } from "./services/menuOriginRepository.js";
import { activateTopicDmEntry, currentTopicDmEntry } from "./services/topicDmEntry.js";

async function main():Promise<void>{
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL_REQUIRED");
 const bot=new Telegraf(BOT_TOKEN,{
  telegram:{agent:new https.Agent({keepAlive:true,family:4})},
 });
 let firstPoll=()=>{};
 boundTelegramCalls(bot.telegram);
 const pollingHealth=installPollingTransport(bot.telegram,BOT_TOKEN,undefined,()=>firstPoll());
 const me=await bot.telegram.getMe();
 if(me.username?.toLowerCase()!=="gaybbs_bot"||me.id===8086265383)
  throw new Error("GAYBBS_BOT_IDENTITY_MISMATCH");
 bot.botInfo=me;
 configureGaybbsDatabaseWaits();
 await runMigrations();
 const queue=new ActorQueue();
 const settling=new Map<number,Promise<void>>();
 bot.use(async(ctx,next)=>{
  boundTelegramCalls(ctx.telegram);
  let complete!:()=>void;
  const settled=new Promise<void>(resolve=>{complete=resolve;});
  settling.set(ctx.update.update_id,settled);
  const started=Date.now();
  const slow=setTimeout(()=>console.warn("GAYBBS_UPDATE_STILL_RUNNING type="+ctx.updateType+" elapsed_ms="+(Date.now()-started)),5000);
  try{
   const query=ctx.callbackQuery,actor=ctx.from?.id;
   const screen=query&&"message" in query&&query.message?String(query.message.chat.id)+":"+query.message.message_id:
    query&&"inline_message_id" in query?query.inline_message_id:undefined;
   const key=query&&screen&&"data" in query?JSON.stringify([screen,query.data]):undefined;
   if(actor&&(query||(ctx.chat?.type==="private"&&ctx.updateType==="message"))){
    await queue.execute(actor,key,async()=>{await next();},async()=>{
     console.log("GAYBBS_DUPLICATE_CALLBACK_COALESCED");
     await ctx.answerCbQuery("処理中です。そのままお待ちください。").catch(()=>undefined);
    });
   }else await next();
   console.log("GAYBBS_UPDATE_COMPLETED type="+ctx.updateType+" elapsed_ms="+(Date.now()-started));
  }
  catch(error){console.error("GAYBBS_UPDATE_FAILED type="+ctx.updateType+" elapsed_ms="+(Date.now()-started));throw error;}
  finally{clearTimeout(slow);settling.delete(ctx.update.update_id);complete();}
 });
 registerBugReportHandlers(bot);
 registerStartlessNavigationHandlers(bot);
 bot.start(async ctx=>{
  if(ctx.chat.type!=="private")return;
  if(ctx.startPayload?.startsWith("p_")){
   try {
    const origin=await activateTopicDmEntry(ctx.from.id,ctx.startPayload,ctx.telegram);
    const keyboard=await bareStartPostingExtra(origin.chatId);
    await ctx.reply(DM_POSTING_MENU_SCREEN_TEXT,keyboard);
   }catch{
    await ctx.reply("このトピックの投稿入口を確認できません。元の固定ボタンを利用してください。");
   }
   return;
  }
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
  if(ctx.startPayload==="bugreport"){
   await startBugReport(ctx.telegram,ctx.from.id);
   return;
  }
  if(ctx.startPayload==="link"){
   await startLinkEditor(ctx.telegram,ctx.from.id);
   return;
  }
  if(ctx.startPayload==="talk"||ctx.startPayload==="invite"){
   await startPostingMenuUtility(ctx.telegram,ctx.from.id,ctx.startPayload);
   return;
  }
  if(ctx.startPayload==="search"){
   await startSearchEditor(ctx.telegram,ctx.from.id);
   return;
  }
  if(ctx.startPayload==="help"){
   await startOperationHelp(ctx.telegram,ctx.from.id);
   return;
  }
  if(ctx.startPayload?.startsWith("j_")){
   try{
    const room=await resolveRoomJoinLink(ctx.from.id,ctx.startPayload);
    if(!room){
     await ctx.reply(await roomJoinDenialReason(ctx.startPayload));
    }else{
     await ctx.reply("🔴 LIVE中｜"+room.title+"\n参加資格を確認しました。",
      Markup.inlineKeyboard([[Markup.button.url("🎥 ROOMへ参加",room.joinUrl)]]));
    }
   }catch{
    await ctx.reply("ROOMへの参加状況を確認できません。");
   }
   return;
  }
  if(ctx.startPayload?.startsWith("a_")){
   if(await isNoticeApplicationLink(ctx.startPayload)){
    await startNoticeApplication(ctx,ctx.startPayload);
   }else await startApplicationEditor(ctx,ctx.startPayload);
   return;
  }
  if(ctx.startPayload && /^(?:m|r)_/.test(ctx.startPayload)){
   try{
    const origin=await activateMenuOrigin(ctx.from.id,ctx.startPayload);
    if(origin.feature==="profile"){
     await startCompactProfileEditor(ctx);
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
  const origin=ctx.from?await currentMenuOrigin(ctx.from.id):null;
  const topicOrigin=origin?null:await currentTopicDmEntry(ctx.from.id);
  const chatId=defaultBareStartChatId(origin?.chatId??topicOrigin?.chatId);
  const keyboard=await bareStartPostingExtra(chatId);
  await ctx.reply(BARE_START_POSTING_TEXT,keyboard);
 });
 // Both current and already-sent posting-menu buttons must use the same
 // user-visible private-editor path. Do not silently swallow DB/Telegram errors.
 const openProfileFromMenu=async (ctx:Parameters<typeof startCompactProfileEditor>[0])=>{
  await ctx.answerCbQuery().catch(()=>undefined);
  try{
   await startCompactProfileEditor(ctx);
  }catch(error){
   console.error("PROFILE_DM_OPEN_FAILED",
    error instanceof Error?error.name:"unknown");
   await ctx.reply("プロフィール入力画面を開けませんでした。入力内容は保持されています。もう一度「プロフ作成」を押してください。")
    .catch(()=>undefined);
  }
 };
 bot.action("dm:nav-unavailable",async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery("このリンクはまだ確認できません。", {show_alert:true});
 });
 bot.action(/^dm:blocked:(profile|announcement|room|link|search|help)$/,async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  // Already-sent posting menus may still carry this old callback_data.
  // Opening the private profile editor must work without republishing menus.
  if(ctx.match[1]==="profile"){
   await openProfileFromMenu(ctx);
   return;
  }
  if(ctx.match[1]==="link"){
   await ctx.answerCbQuery();
   const tappedId=("message" in ctx.callbackQuery
    ?ctx.callbackQuery.message?.message_id:undefined);
   await startLinkEditor(ctx.telegram,ctx.from.id,tappedId);
   return;
  }
  await ctx.answerCbQuery(
   "この機能は現在準備中です。各掲示板の固定投稿メニューからお試しください。",
   { show_alert: true },
  );
 });
 bot.action(/^dm:(profile|recruit|room|announcement|link|search|help)$/,async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  const kind=ctx.match[1];
  if(kind==="profile"){await openProfileFromMenu(ctx);return;}
  await ctx.answerCbQuery();
  // All selected editors must replace the exact tapped DM menu rather than
  // append below it or silently modify a stale screen elsewhere.
  const tappedId=("message" in ctx.callbackQuery
   ?ctx.callbackQuery.message?.message_id:undefined);
  if(kind==="recruit")await startCompactRecruitmentEditor(ctx.telegram,ctx.from.id,tappedId);
  else if(kind==="room")await startRoomEditor(ctx.telegram,ctx.from.id,tappedId);
  else if(kind==="announcement")await startAnnouncementEditor(ctx.telegram,ctx.from.id,tappedId);
  else if(kind==="link")await startLinkEditor(ctx.telegram,ctx.from.id,tappedId);
  else if(kind==="search")await startSearchEditor(ctx.telegram,ctx.from.id,tappedId);
  else await startOperationHelp(ctx.telegram,ctx.from.id,tappedId);
 });
 registerCompactRecruitmentHandlers(bot);
 registerPostingMenuUtilityHandlers(bot);
 registerCompactProfileHandlers(bot);
 // /profile is not a navigation command for users, but old explicit links
 // must still reach today's compact screen rather than the retired wizard.
 bot.command("profile",async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await startCompactProfileEditor(ctx);
 });
 // Retired profile keyboards must not recreate the old seven-position wizard.
 // The real current compact profile editor reuses the exact tapped DM message.
 // Preserve existing draft/profile and already published messages.
 // Current compact appearance uses the shared pf:ap/ar/section handlers.
 // Do not consume these callbacks in the retired-screen fallback.
 bot.action(/^pf:(?!(?:ap|ar|section):)/,async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery("現在のプロフィール画面を開きます。");
  await startCompactProfileEditor(ctx);
 });
 registerProfileHandlers(bot,undefined,undefined,returnFromCompactAppearance);
 registerProfileViewerHandlers(bot);
 registerProfilePostManagement(bot);
 registerPostingHandlers(bot);
 registerNoticeInteractionHandlers(bot);
 registerLinkInlineHandlers(bot);
 registerTopicBindingHandlers(bot);
 registerGeneralGuideHandlers(bot);
 registerMenuPanelHandlers(bot);
 registerTopicBoardHandlers(bot);
 registerSearchHandlers(bot);
 registerOperationHelpHandlers(bot);
 registerApplicationHandlers(bot);
 registerRoomHandlers(bot);
 registerGayBbsApprovalHandlers(bot);
 registerOnlineGateCheckHandler(bot);
 let maintenance:Promise<void>|undefined;
 const maintainMenus=async()=>{
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
  const dmScopes=await suppressBotDmCommandMenu(bot.telegram);
  console.log("GAYBBS_DM_COMMAND_MENU_SUPPRESSED scopes="+dmScopes.join(","));
 }catch(error){
  console.error("GAYBBS_DM_COMMAND_SUPPRESSION_FAILED",
    error instanceof Error?error.message:"unknown");
 }
 try{
  const videoScopes=await suppressGroupCommandMenu(bot.telegram,VIDEO_CHAT_CHAT_ID);
  console.log("GAYBBS_VIDEO_CHAT_MENU_SUPPRESSED scopes="+videoScopes.join(","));
 }catch(error){
  console.error("GAYBBS_VIDEO_CHAT_MENU_SUPPRESSION_FAILED",
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
 };
 firstPoll=()=>{maintenance=maintainMenus().catch(error=>console.error("GAYBBS_MENU_MAINTENANCE_FAILED",error instanceof Error?error.name:"unknown"));};
 bot.catch(async(error,ctx)=>{
  console.error("[GAYBBS_ERROR]",ctx.updateType,error instanceof Error?error.name:"unknown");
  // Telegraf handlerTimeout does not cancel middleware. Never advance the
  // polling offset while the timed-out handler is still running.
  await settling.get(ctx.update.update_id);
 });
 let stopWorkers:(()=>void)|undefined;
 let stopReports:(()=>void)|undefined;
 let tumblrBridge:ReturnType<typeof startTumblrBridge>=null;
 let stopping=false;
 let monitor:ReturnType<typeof setInterval>|undefined;
 let recovery=false;
 const stop=(signal:string)=>{
  if(stopping)return;
  stopping=true;
  stopReports?.();stopWorkers?.();
  bot.stop(signal);
 };
 process.once("SIGINT",()=>{try{stop("SIGINT");}catch{process.exitCode=1;}});
 process.once("SIGTERM",()=>{try{stop("SIGTERM");}catch{process.exitCode=1;}});
 try{
  await bot.launch({
   dropPendingUpdates:false,
   allowedUpdates:["message","callback_query","chat_join_request","inline_query"],
  },()=>{
   console.log("GAYBBS_BOT_READY bot_id="+me.id);
   stopWorkers=startGayBbsWorkers(bot.telegram);
   stopReports=startBugReportDeliveryWorker(bot.telegram);
   monitor=setInterval(()=>{
    const health=pollingHealth();
    if(Date.now()-health.lastSuccess<180000||Date.now()<health.retryUntil)return;
    console.warn("GAYBBS_POLLING_STALLED elapsed_ms="+(Date.now()-health.lastSuccess)+" active_updates="+settling.size);
    // Telegraf owns offset synchronization. Restart only when no update
    // handler is outstanding; never kill an in-flight publish.
    if(health.consecutiveFailures>=3&&settling.size===0&&!stopping){
     recovery=true;stop("polling-recovery");
    }
   },30000);
   try{tumblrBridge=startTumblrBridge(bot.telegram);}
   catch(error){console.error("TUMBLR_BRIDGE_START_FAILED",error instanceof Error?error.name:"unknown");}
  });
 }finally{
  if(monitor)clearInterval(monitor);
  stopReports?.();stopWorkers?.();
  if(maintenance)await maintenance;
  if(tumblrBridge)await new Promise<void>(resolve=>tumblrBridge!.close(()=>resolve()));
  await closePool();
 }
 if(recovery)process.exitCode=1;
}
main().catch(error=>{
 console.error("GAYBBS_STARTUP_FAILED",error instanceof Error?error.name:"unknown");
 process.exitCode=1;
});
