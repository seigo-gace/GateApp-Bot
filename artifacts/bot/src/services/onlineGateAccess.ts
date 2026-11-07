/** Reuse the already installed entry-Gate Bot approval state.
 * Source for ONLINE URL button follows: 3 public buttons -> this Gate Bot
 * /start payload -> membership/approval lookup -> destination or Gate.
 * Telegram cannot redirect to an external Topic without a user's next tap.
 */
import type {Telegraf,Context,Telegram} from "telegraf";
import {Markup} from "telegraf";
import * as blacklistRepo from "../repositories/blacklistRepo.js";
import * as targetRepo from "../repositories/targetRepo.js";
import {commonGayBbsApproval,startGayBbsAdmission} from "../modules/gaybbsApproval/handlers.js";
import {resolveOnlineGatePayload,rememberOnlineGateDestination,
 recallOnlineGateDestination,type OnlineRoute} from "./onlineGateRoutes.js";
export type OnlineMember="member"|"not_member"|"unknown";
export function onlineMemberFromTelegram(value:unknown):OnlineMember{
 if(!value||typeof value!=="object"||!("status" in value))return "unknown";
 const x=value as {status:unknown;is_member?:unknown};
 if(["creator","administrator","member"].includes(String(x.status)))return "member";
 if(x.status==="restricted")return x.is_member===true?"member":x.is_member===false?"not_member":"unknown";
 if(x.status==="left"||x.status==="kicked")return "not_member";
 return "unknown";
}
export async function onlineMembership(telegram:Telegram,chatId:number,userId:number):Promise<OnlineMember>{
 try{return onlineMemberFromTelegram(await telegram.getChatMember(chatId,userId));}
 catch{return "unknown";}
}
export type OnlineGateDecision="open_topic"|"join_after_approval"|"begin_gate"|"refuse";
export function onlineGateDecision(member:OnlineMember,approved:boolean,blocked:boolean):OnlineGateDecision{
 if(blocked||member==="unknown")return "refuse";
 // Telegram membership is NOT evidence of common Gate approval.
 if(!approved)return "begin_gate";
 return member==="member"?"open_topic":"join_after_approval";
}
export async function deliverOnlineDestination(
 telegram:Telegram,userId:number,route:OnlineRoute,
):Promise<boolean>{
 const member=await onlineMembership(telegram,route.chatId,userId);
 if(member!=="member")return false;
 const hub=route.key==="online_hub";
 await telegram.sendMessage(userId,
  hub?"✅ 参加中のグループを確認しました。下のボタンからオンラインビデオChat案内へ進めます。"
  :"✅ 参加中のグループを確認しました。下のボタンから目的のROOM関連トピックへ進めます。",
  Markup.inlineKeyboard([[Markup.button.url(hub?"🔗 オンライン案内へ":"🎬 ROOM掲示板へ",route.topicUrl)]]));
 return true;
}
export async function handleOnlineGateStart(
 ctx:Context & {startPayload?:string},
):Promise<boolean>{
 const payload=ctx.startPayload||"";
 if(!payload.startsWith("online_"))return false;
 const user=ctx.from,chat=ctx.chat;
 if(!user||chat?.type!=="private")return true;
 const route=await resolveOnlineGatePayload(payload);
 if(!route){
  await ctx.reply("このONLINE案内リンクは無効または未公開です。元の案内からやり直してください。");
  return true;
 }
 const [blocked,target]=await Promise.all([
  blacklistRepo.getBlacklisted(user.id),
  targetRepo.getTargetById(route.targetId),
 ]);
 if(blocked?.status==="blocked"||!target||Number(target.chat_id)!==route.chatId){
  await ctx.reply("このグループには参加できません。");
  return true;
 }
 if(!user.username){
  await ctx.reply("利用にはTelegramユーザーネームの設定が必要です。設定後、元の案内から開始してください。");
  return true;
 }
 const member=await onlineMembership(ctx.telegram,route.chatId,user.id);
 if(member==="unknown"){
  await ctx.reply("参加状態を確認できません。時間をおいて再度お試しください。");
  return true;
 }
 const approved=await commonGayBbsApproval(ctx.telegram,user.id,route.targetId);
 const decision=onlineGateDecision(member,approved,false);
 await rememberOnlineGateDestination(user.id,route);
 if(decision==="open_topic"){
  if(!await deliverOnlineDestination(ctx.telegram,user.id,route))
   await ctx.reply("参加状態を再確認できませんでした。後でもう一度お試しください。");
  return true;
 }
 if(decision==="join_after_approval"||decision==="begin_gate"){
  // The same common Gate issues user-specific, one-use join-request links.
  // Never use inviteService.createInviteLink here; it lacks this module's
  // attempt/consent/user_id bound join-request ledger.
  await startGayBbsAdmission(ctx,`gate_${target.gate_code}`);
  return true;
 }
 await ctx.reply("参加状態を確認できません。");
 return true;
}
export function registerOnlineGateCheckHandler(bot:Telegraf):void{
 bot.action("online:check",async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery();
  const route=await recallOnlineGateDestination(ctx.from.id);
  if(!route){await ctx.reply("案内の有効な移動先がありません。元のONLINE案内から始めてください。");return;}
  const blacklist=await blacklistRepo.getBlacklisted(ctx.from.id);
  if(blacklist?.status==="blocked"){await ctx.reply("参加できません。");return;}
  const member=await onlineMembership(ctx.telegram,route.chatId,ctx.from.id);
  if(member==="unknown"){await ctx.reply("参加状態が確認できません。後で再確認してください。");return;}
  if(member!=="member"){
   await ctx.reply("グループへの参加完了をまだ確認できません。参加後、もう一度このボタンを押してください。");
   return;
  }
  const approved=await commonGayBbsApproval(ctx.telegram,ctx.from.id,route.targetId);
  if(!approved){
   await ctx.reply("参加中でも承認質問の完了が必要です。元の参加案内から審査を始めてください。");
   return;
  }
  if(!await deliverOnlineDestination(ctx.telegram,ctx.from.id,route))
   await ctx.reply("参加状態を再確認できませんでした。後でもう一度お試しください。");
 });
}
