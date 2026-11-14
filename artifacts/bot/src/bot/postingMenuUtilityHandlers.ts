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
import {getOnlineGateLinks,ONLINE_GROUPS} from "../services/onlineGateRoutes.js";
import {showWizardScreen} from "../services/dmWizardScreen.js";

export const TALK_TOPICS=[
 {label:"エリア’s BBS",url:"https://t.me/c/3847210571/44"},
 {label:"ビデオChatの掲示板",url:"https://t.me/c/2373696859/4291"},
 {label:"ゲイのための掲示板♂",url:"https://t.me/c/3770334893/789"},
] as const;

function menuScreenId(ctx:any):number|undefined{
 const msg=ctx.callbackQuery&&"message" in ctx.callbackQuery?
  ctx.callbackQuery.message:undefined;
 return Number.isSafeInteger(msg?.message_id)?msg.message_id:undefined;
}
async function showTalk(t:Telegram,id:number,screenId?:number):Promise<void>{
 const keyboard=Markup.inlineKeyboard([
  ...TALK_TOPICS.map(x=>[Markup.button.url(x.label,x.url)]),
  [Markup.button.callback("↩ 戻る","dm:utility:home")],
 ]);
 await showWizardScreen(t,id,screenId,"💬 雑談するグループを選んでください。",keyboard);
}
type CopyCell={text:string;copy_text:{text:string}};
export function copyInviteCell(label:string,url:string):CopyCell{
 if(!/^https:\/\/t\.me\/[A-Za-z0-9_+/?=&-]{2,250}$/.test(url))
  throw new Error("INVITE_LINK_NOT_VERIFIED");
 return {text:label,copy_text:{text:url}};
}
export async function inviteCopyRows(
 membership:(chatId:number)=>Promise<boolean>,
 links:readonly {group:string;gateStartUrl:string;verified:boolean}[]
):Promise<CopyCell[][]>{
 const names=["エリア’s BBS","ビデオChatの掲示板","ゲイのための掲示板♂"];
 const keys=["area_bbs","video_chat","gay_board"] as const;
 const rows:CopyCell[][]=[];
 for(let i=0;i<keys.length;i++){
  const key=keys[i]!,group=ONLINE_GROUPS[key];
  const joined=await membership(group.chatId);
  const route=links.find(x=>x.group===key);
  if(joined){
   const groupId=String(group.chatId).slice(4);
   rows.push([copyInviteCell("📋 "+names[i]+"のリンク", "https://t.me/c/"+groupId+"/1")]);
  }else if(route?.verified===true){
   rows.push([copyInviteCell("📋 "+names[i]+"の承認ゲート",route.gateStartUrl)]);
  }else{
   throw Error("INVITE_GATE_ROUTE_UNVERIFIED:"+key);
  }
 }
 return rows;
}
async function showInvite(t:Telegram,id:number,screenId?:number):Promise<void>{
 const links=await getOnlineGateLinks();
 const rows=await inviteCopyRows(async chatId=>{
  try{
   const user=await t.getChatMember(chatId,id);
   return user.status==="creator"||user.status==="administrator"||
    user.status==="member"||(user.status==="restricted"&&user.is_member===true);
  }catch{return false;}
 },links);
 const raw=[...rows,[{text:"↩ 戻る",callback_data:"dm:utility:home"}]];
 const keyboard=Markup.inlineKeyboard(raw as unknown as Parameters<typeof Markup.inlineKeyboard>[0]);
 await showWizardScreen(t,id,screenId,
  "🔗 紹介/招待\nコピーするリンクを押してください。\n未参加のグループは承認ゲート、参加済みのグループは直接開くリンクをコピーします。",keyboard);
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
