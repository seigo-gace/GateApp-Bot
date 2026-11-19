/** Existing @GayBBS_bot posting-menu utilities.
 * Talk: choose one of the three Master-verified talk topic URLs.
 * Invite: copy an existing approved Gate route, or a group permalink when
 * actual membership is verified. This does not grant membership.
 */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {bareStartPostingExtra,defaultBareStartChatId,BARE_START_POSTING_TEXT}
 from "../services/dmBareStartPostingMenu.js";
import {currentMenuOrigin} from "../services/menuOriginRepository.js";
import {currentTopicDmEntry} from "../services/topicDmEntry.js";
import {commonGateUrl,gateInviteCopyButton} from "../services/commonGateInvite.js";
import {showWizardScreen} from "../services/dmWizardScreen.js";
import {TALK_TOPICS} from "../services/talkDestinationContract.js";
import {onlineMembership,type OnlineMember} from "../services/onlineGateAccess.js";
import {commonGayBbsApproval,startGayBbsAdmission} from "../modules/gaybbsApproval/handlers.js";
import * as blacklistRepo from "../repositories/blacklistRepo.js";
import {pool} from "../db/index.js";

export {TALK_TOPICS} from "../services/talkDestinationContract.js";

const TALK_GROUP_IDS=TALK_TOPICS.map(x=>x.chatId);
export function canDirectTalkTopic(approved:boolean,member:OnlineMember):boolean{
 return approved===true&&member==="member";
}
async function talkTarget(index:number):Promise<{targetId:number;gateCode:string}|null>{
 const chatId=TALK_GROUP_IDS[index];
 if(!chatId)return null;
 const rows=await pool.query<{target_id:number;gate_code:string}>(
  "SELECT target_id,gate_code FROM targets WHERE target_type='entry_group' AND chat_id=$1",
  [chatId]);
 if(rows.rows.length!==1)return null;
 const row=rows.rows[0]!;
 return Number.isSafeInteger(Number(row.target_id))&&
  /^[A-Za-z0-9_-]{1,48}$/.test(row.gate_code)
  ?{targetId:Number(row.target_id),gateCode:row.gate_code}:null;
}
async function talkEligible(t:Telegram,id:number,index:number):Promise<boolean>{
 try{
  const target=await talkTarget(index);
  if(!target)return false;
  const member=await onlineMembership(t,TALK_GROUP_IDS[index]!,id);
  if(member!=="member")return false;
  return canDirectTalkTopic(await commonGayBbsApproval(t,id,target.targetId),member);
 }catch{return false;}
}

function menuScreenId(ctx:any):number|undefined{
 const msg=ctx.callbackQuery&&"message" in ctx.callbackQuery?
  ctx.callbackQuery.message:undefined;
 return Number.isSafeInteger(msg?.message_id)?msg.message_id:undefined;
}
async function showTalk(t:Telegram,id:number,screenId?:number):Promise<void>{
 const choices=await Promise.all(TALK_TOPICS.map(async(x,i)=>[
  await talkEligible(t,id,i)
   ? Markup.button.url(x.label,x.url)
   : Markup.button.callback(x.label,"dm:talk:topic:"+i)
 ]));
 const keyboard=Markup.inlineKeyboard([
  ...choices,
  [Markup.button.callback("↩ 戻る","dm:utility:home")],
 ]);
 await showWizardScreen(t,id,screenId,"💬 雑談するグループを選んでください。",keyboard);
}
type CopyCell={text:string;copy_text:{text:string}};
export function copyInviteCell(label:string,url:string):CopyCell{
 if(!/^https:\/\/t\.me\/[A-Za-z0-9_+/?=&-]{2,250}$/.test(url))
  throw new Error("INVITE_LINK_NOT_VERIFIED");
 return gateInviteCopyButton(label,url);
}
/** One shared questionnaire and post-approval three-group chooser. */
export function commonInviteCopyRows(url:string):CopyCell[][]{
 return [[copyInviteCell("📋 共通参加承認ゲートをコピー",url)]];
}
async function showInvite(t:Telegram,id:number,screenId?:number):Promise<void>{
 const url=await commonGateUrl();
 const raw=[...commonInviteCopyRows(url),
  [{text:"↩ 戻る",callback_data:"dm:utility:home"}]];
 const keyboard=Markup.inlineKeyboard(raw as unknown as Parameters<typeof Markup.inlineKeyboard>[0]);
 await showWizardScreen(t,id,screenId,
  "🔗 紹介/招待\\n共通承認ゲートのリンクをコピーしてください。\\n承認質問は1回だけです。承認後に3グループから参加先を選択できます。",keyboard);
}
export async function startPostingMenuUtility(
 t:Telegram,id:number,kind:"talk"|"invite",screenId?:number
):Promise<void>{
 if(kind==="talk")await showTalk(t,id,screenId);
 else await showInvite(t,id,screenId);
}
export function registerPostingMenuUtilityHandlers(bot:Telegraf):void{
 bot.action(/^dm:(talk|invite)$/,async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery();
  await startPostingMenuUtility(ctx.telegram,ctx.from.id,ctx.match[1] as "talk"|"invite",menuScreenId(ctx));
 });
 bot.action(/^dm:talk:topic:([012])$/,async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery();
  const index=Number(ctx.match[1]);
  const denied=await blacklistRepo.getBlacklisted(ctx.from.id);
  if(denied?.status==="blocked"){
   await ctx.telegram.sendMessage(ctx.from.id,"参加できません。");return;
  }
  const target=await talkTarget(index);
  if(!target){
   await ctx.telegram.sendMessage(ctx.from.id,"参加先の設定を確認できません。");return;
  }
  if(await talkEligible(ctx.telegram,ctx.from.id,index)){
   await showWizardScreen(ctx.telegram,ctx.from.id,menuScreenId(ctx),
    "💬 雑談するグループを選んでください。",
    Markup.inlineKeyboard([
     ...TALK_TOPICS.map((x,i)=>[
      i===index?Markup.button.url(x.label,x.url):
       Markup.button.callback(x.label,"dm:talk:topic:"+i)
     ]),
     [Markup.button.callback("↩ 戻る","dm:utility:home")],
    ]));
   return;
  }
  // Reuse the ONE existing questionnaire and membership chooser.
  // Do not hand out topic URLs to unapproved or unverified members.
  await startGayBbsAdmission(ctx,"gate_"+target.gateCode,index,menuScreenId(ctx));
 });
 bot.action("dm:utility:home",async ctx=>{
  if(ctx.chat?.type!=="private"||!ctx.from)return;
  await ctx.answerCbQuery();
  const origin=await currentMenuOrigin(ctx.from.id);
  const topic=origin?null:await currentTopicDmEntry(ctx.from.id);
  const keyboard=await bareStartPostingExtra(defaultBareStartChatId(origin?.chatId??topic?.chatId));
  await showWizardScreen(ctx.telegram,ctx.from.id,menuScreenId(ctx),
   BARE_START_POSTING_TEXT,keyboard);
 });
}
