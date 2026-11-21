/** Existing users route group public buttons to an already-open Bot DM.
 * Group message bodies are never edited, replied to, deleted or reposted here.
 * A first-time user can still use Telegram's native initial Start once.
 */
import {Markup,type Telegraf} from "telegraf";
import {BOARD_GROUP_CHAT_IDS} from "../services/topicRouting.js";
import {activateMenuOrigin} from "../services/menuOriginRepository.js";
import {activateTopicDmEntry} from "../services/topicDmEntry.js";
import {bareStartPostingExtra} from "../services/dmBareStartPostingMenu.js";
import {resolvePublishedProfileView} from "../services/profilePublicView.js";
import {resolveRoomJoinLink,roomJoinDenialReason} from "../services/roomJoinLinks.js";
import {callbackStartlessPayload} from "../services/startlessNavigation.js";
import {startProfileViewer} from "./profileViewerHandlers.js";
import {startApplicationEditor} from "./applicationHandlers.js";

const safeCommands:Readonly<Record<string,{label:string;callback:string}>>={
 search:{label:"検索/フィルター",callback:"dm:search"},
 help:{label:"操作説明",callback:"dm:help"},
 bugreport:{label:"🐞 不具合を報告",callback:"dm:bug:open"},
 talk:{label:"雑談",callback:"dm:talk"},
 invite:{label:"紹介/招待",callback:"dm:invite"},
 link:{label:"🔗ボタン作成",callback:"dm:link"},
};
function entryCallback(feature:string,payload:string){
 if(payload.startsWith("r_"))return "dm:recruit";
 const selected:Readonly<Record<string,string>>={
  profile:"dm:profile",room:"dm:room",announcement:"dm:announcement",
  link:"dm:link",search:"dm:search",help:"dm:help",
 };
 return selected[feature]??null;
}
export function registerStartlessNavigationHandlers(bot:Telegraf):void{
 bot.action(/^gdm:(.+)$/,async ctx=>{
  if(!ctx.from||!ctx.chat||!Object.values(BOARD_GROUP_CHAT_IDS).includes(ctx.chat.id)){
   await ctx.answerCbQuery("このボタンは対象の掲示板から利用してください。",{show_alert:true});
   return;
  }
  const payload=callbackStartlessPayload("gdm:"+ctx.match[1]);
  if(!payload){await ctx.answerCbQuery("このボタンは利用できません。",{show_alert:true});return;}
  const userId=ctx.from.id;
  try{
   if(payload.startsWith("p_")){
    const topic=await activateTopicDmEntry(userId,payload,ctx.telegram);
    const menu=await bareStartPostingExtra(topic.chatId);
    await ctx.telegram.sendMessage(userId,"📝 投稿メニュー\n機能を選択してください。",menu);
   }else if(payload.startsWith("m_")||payload.startsWith("r_")){
    const verified=await activateMenuOrigin(userId,payload);
    const target=entryCallback(verified.feature,payload);
    if(!target)throw Error("STARTLESS_MENU_FEATURE_UNSUPPORTED");
    const label=payload.startsWith("r_")?"相手募集":
     verified.feature==="announcement"?"告知/予告":verified.feature==="room"?"募集+Room":
     verified.feature==="profile"?"プロフ作成":verified.feature==="link"?"🔗ボタン作成":
     verified.feature==="search"?"検索/フィルター":"操作説明";
    await ctx.telegram.sendMessage(userId,label+"\n下のボタンを押して操作してください。",
     Markup.inlineKeyboard([[Markup.button.callback(label,target)]]));
   }else if(payload.startsWith("j_")){
    const room=await resolveRoomJoinLink(userId,payload);
    if(room)await ctx.telegram.sendMessage(userId,"🔴 LIVE中｜"+room.title+"\n参加資格を確認しました。",
      Markup.inlineKeyboard([[Markup.button.url("🎥 ROOMへ参加",room.joinUrl)]]));
    else await ctx.telegram.sendMessage(userId,await roomJoinDenialReason(payload));
   }else if(payload.startsWith("a_")){
    // The original application payload is checked again by the DM handler.
    await ctx.telegram.sendMessage(userId,"📝 応募内容を確認",
     Markup.inlineKeyboard([[Markup.button.callback("応募画面を開く","gdm:application:"+payload.slice(2))]]));
   }else if(/^(?:pv|pm|pt)_/.test(payload)){
    const token=payload.slice(3);
    if(!await resolvePublishedProfileView(token))throw Error("PROFILE_UNPUBLISHED");
    await ctx.telegram.sendMessage(userId,"🪪 公開プロフィールを表示",
     Markup.inlineKeyboard([[Markup.button.callback("開く","gdm:viewer:"+payload)]]));
   }else{
    const item=safeCommands[payload];
    if(!item)throw Error("STARTLESS_UNKNOWN_FEATURE");
    await ctx.telegram.sendMessage(userId,item.label+"\n下のボタンから操作してください。",
     Markup.inlineKeyboard([[Markup.button.callback(item.label,item.callback)]]));
   }
   await ctx.answerCbQuery("BotのDMに操作メニューを送りました。");
  }catch(error){
   // Telegram 403 means the user has never opened (or has blocked) this Bot.
   // The first contact requires ONE native Start; never prescribe repetitions.
   const code=(error as {response?:{error_code?:number}})?.response?.error_code;
   await ctx.answerCbQuery(code===403?
    "初回だけBotのDMを開き、Startを押してください。":
    "入口を確認できません。元の固定メニューから操作してください。",{show_alert:true});
  }
 });
 bot.action(/^gdm:application:([A-Za-z0-9_-]{16,48})$/,async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery();
  await startApplicationEditor(ctx,"a_"+ctx.match[1]);
 });
 bot.action(/^gdm:viewer:((?:pv|pm|pt)_[A-Za-z0-9_-]{32})$/,async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery();
  await startProfileViewer(ctx,ctx.match[1]);
 });
}
