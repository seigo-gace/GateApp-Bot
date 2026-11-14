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
import {ADMISSION_BOARD_CHAT_IDS} from "../modules/gaybbsApproval/contract.js";
import {pool} from "../db/index.js";
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
/** One shared questionnaire and post-approval three-group chooser. */
export function commonInviteCopyRows(url:string):CopyCell[][]{
 return [[copyInviteCell("📋 共通参加承認ゲートをコピー",url)]];
}
async function commonGateUrl():Promise<string>{
 const r=await pool.query<{chat_id:string;gate_code:string}>(`
 SELECT chat_id,gate_code FROM targets
 WHERE target_type='entry_group' AND chat_id=ANY($1::bigint[])
 ORDER BY chat_id`,[ADMISSION_BOARD_CHAT_IDS]);
 if(r.rows.length!==3||new Set(r.rows.map(x=>String(x.chat_id))).size!==3 ||
    r.rows.some(x=>!new Set<number>(ADMISSION_BOARD_CHAT_IDS).has(Number(x.chat_id))||
      !/^[A-Za-z0-9_-]{1,48}$/.test(String(x.gate_code))))
  throw new Error("COMMON_GATE_ROUTE_NOT_VERIFIED");
 return "https://t.me/GayBBS_bot?start=gate_"+r.rows[0]!.gate_code;
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
