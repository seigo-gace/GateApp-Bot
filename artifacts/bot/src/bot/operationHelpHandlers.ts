/** Adopted operation-help layout: three columns × two rows.
 * Reuses the shared wizard screen and exact pre-existing feature editors.
 * Help text is explanatory, never an alternative posting implementation.
 */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {showWizardScreen} from "../services/dmWizardScreen.js";
import {APPROVED_HELP_ROWS} from "../services/menuPanelRenderer.js";
import {verifiedPostingMenuReturnUrl} from "../services/menuOriginRepository.js";
import {startRoomEditor,startAnnouncementEditor,startLinkEditor} from "./postingHandlers.js";

import {startSearchEditor} from "./searchHandlers.js";
import {startProfileEditor} from "./profileHandlers.js";

type Topic="profile"|"room"|"announcement"|"link"|"search";
type HelpSection=Topic|"home";
type Session={revision:number;section:HelpSection;screenMessageId:number|null};
const SECTION_KEYS:readonly Topic[]=["profile","room","announcement","link","search"];
const sectionLabels:Readonly<Record<Topic,string>>={
 profile:"プロフ",room:"Room+募集",announcement:"告知/予告",
 link:"🔗ボタン作成",search:"検索/フィルター"
};
const sectionText:Readonly<Record<Topic,string>>={
 profile:"🪪 プロフ（プロフィール）\n① 名前と身長・体重・年齢を入力します。\n② ポジション、容姿・エリア、写真・動画・自己PR、#Like/#Loveを選択します。\n③ プレビューを確認して保存します。保存だけなら非公開です。掲載したい場合は別途、公開先と内容を確認して公開します。",
 room:"🎬 Room+募集\n① ROOMのタイトル・説明を入力します。\n② 参加方式とプロフィール連携を選びます。\n③ 内容・投稿先を確認してから公開します。\n入力途中の内容は保持され、公開前ならキャンセルできます。\n「▶ この機能を開く」から投稿機能へ進みます。",
 announcement:"📣 告知/予告\n① 告知または予告の種類を選びます。\n② 本文を入力し、予告の場合は日本時間で日時を指定します。\n③ プロフィールとの連携や投稿先を確認します。\n④ プレビューを確認し、本人が公開ボタンを押した場合だけ投稿します。\n入力を中断しても未公開の下書きは残ります。",
 link:"🔗 ボタン作成\n① 1行目に本文を入力します。\n② 2行目以降に1ボタンずつ『表示名 | https://URL』と書きます。\n③ 1〜3列の表示を選び、プレビューで表示名・リンク先を確認します。\n④ 必要なら修正して、投稿先を確認し公開します。\nHTTPや短縮URLなど、使用できないリンクは理由を確認して修正します。",
 search:"🔍 検索/フィルター\n① プロフィールと相手募集から探す対象を選びます。\n② キーワードや地域・目的などで絞ります。プロフィールでは年齢・体型・髪型・#Like/#Loveも選択できます。\n③ 検索結果を5件ずつ確認し、気になる投稿を開きます。\n現在参加中のグループの公開済み投稿だけを表示します。"
};
export function helpHomeKeyboard(rev:number){
 return Markup.inlineKeyboard(APPROVED_HELP_ROWS.map(row=>row.map(label=>
  Markup.button.callback(label,label==="戻る"?`help:back:${rev}`:
    `help:topic:${rev}:${SECTION_KEYS.find(key=>sectionLabels[key]===label)}`))));
}
export function helpSectionKeyboard(rev:number,section:Topic){
 return Markup.inlineKeyboard([
  [Markup.button.callback("▶ この機能を開く",`help:open:${rev}:${section}`)],
  [Markup.button.callback("↩ 操作説明へ戻る",`help:home:${rev}`)],
 ]);
}
async function load(id:number):Promise<Session|null>{
 const r=await pool.query("SELECT revision,section,screen_message_id FROM gaybbs_help_sessions WHERE owner_user_id=$1",[id]);
 if(!r.rows.length)return null;
 const x=r.rows[0];return {revision:Number(x.revision),section:x.section,
  screenMessageId:x.screen_message_id===null?null:Number(x.screen_message_id)};
}
async function begin(id:number):Promise<Session>{
 const r=await pool.query(`INSERT INTO gaybbs_help_sessions(owner_user_id)
  VALUES($1) ON CONFLICT(owner_user_id) DO UPDATE SET
   section='home',revision=gaybbs_help_sessions.revision+1,updated_at=NOW()
   RETURNING revision,section,screen_message_id`,[id]);
 const x=r.rows[0];return {revision:Number(x.revision),section:x.section,
  screenMessageId:x.screen_message_id===null?null:Number(x.screen_message_id)};
}
async function advance(id:number,revision:number,section:HelpSection):Promise<Session>{
 const r=await pool.query(`UPDATE gaybbs_help_sessions SET
    revision=revision+1,section=$3,updated_at=NOW()
    WHERE owner_user_id=$1 AND revision=$2
    RETURNING revision,section,screen_message_id`,[id,revision,section]);
 if(r.rows.length!==1)throw Error("HELP_REVISION_STALE");
 const x=r.rows[0];return {revision:Number(x.revision),section:x.section,
  screenMessageId:x.screen_message_id===null?null:Number(x.screen_message_id)};
}
async function show(t:Telegram,id:number,s:Session){
 const topic=s.section==="home"?null:s.section;
 const text=topic===null?"📚 操作説明\n知りたい機能を選択してください。":sectionText[topic];
 const keyboard=topic===null?helpHomeKeyboard(s.revision):helpSectionKeyboard(s.revision,topic);
 const view=await showWizardScreen(t,id,s.screenMessageId??undefined,text,keyboard);
 if(s.screenMessageId!==view.messageId){
  const updated=await pool.query("UPDATE gaybbs_help_sessions SET screen_message_id=$3 WHERE owner_user_id=$1 AND revision=$2 RETURNING owner_user_id",
   [id,s.revision,view.messageId]);
  if(updated.rows.length!==1)throw Error("HELP_SCREEN_STALE");
 }
}
export async function startOperationHelp(t:Telegram,id:number):Promise<void>{
 const s=await begin(id);
 await show(t,id,s);
}
export function registerOperationHelpHandlers(bot:Telegraf):void{
 bot.command("help",async ctx=>{
  if(ctx.chat.type!=="private")return;
  await startOperationHelp(ctx.telegram,ctx.from.id);
 });
 bot.action(/^help:(topic|open):(\d+):(profile|room|announcement|link|search)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const op=ctx.match[1],rev=Number(ctx.match[2]),topic=ctx.match[3] as Topic;
  const s=await load(ctx.from.id);
  if(!s||s.revision!==rev||(op==="open"&&s.section!==topic)||
   (op==="topic"&&s.section!=="home")){
   await ctx.answerCbQuery("古い操作です。投稿メニューの操作説明から再度お試しください。");return;
  }
  await ctx.answerCbQuery();
  if(op==="topic"){
   await show(ctx.telegram,ctx.from.id,await advance(ctx.from.id,rev,topic));return;
  }
  // Invalidate the help callback generation BEFORE handing off the exact
  // Bot-owned message to another wizard. No new message or editor copy.
  const screenId=s.screenMessageId??undefined;
  if(!screenId){await startOperationHelp(ctx.telegram,ctx.from.id);return;}
  await advance(ctx.from.id,rev,"home");
  if(topic==="profile")await startProfileEditor(ctx,undefined,screenId);
  else if(topic==="room")await startRoomEditor(ctx.telegram,ctx.from.id,screenId);
  else if(topic==="announcement")await startAnnouncementEditor(ctx.telegram,ctx.from.id,screenId);
  else if(topic==="link")await startLinkEditor(ctx.telegram,ctx.from.id,screenId);
  else await startSearchEditor(ctx.telegram,ctx.from.id,screenId);
 });
 bot.action(/^help:(home|back):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const op=ctx.match[1],rev=Number(ctx.match[2]),s=await load(ctx.from.id);
  if(!s||s.revision!==rev){
   await ctx.answerCbQuery("古い操作です。投稿メニューの操作説明から再度お試しください。");return;
  }
  await ctx.answerCbQuery();
  const next=await advance(ctx.from.id,rev,"home");
  if(op==="home"||s.section!=="home"){await show(ctx.telegram,ctx.from.id,next);return;}
  const url=await verifiedPostingMenuReturnUrl(ctx.from.id);
  const message=url?
   "📚 操作説明を終了しました。\n元の投稿メニューへ戻れます。":
   "📚 操作説明を終了しました。\n元の投稿メニューが確認できないため、リンクを作成しません。";
  const keyboard=Markup.inlineKeyboard(url?[[Markup.button.url("↩ 投稿メニュー",url)]]:[]);
  const view=await showWizardScreen(ctx.telegram,ctx.from.id,next.screenMessageId??undefined,message,keyboard);
  if(view.messageId!==next.screenMessageId)
   await pool.query("UPDATE gaybbs_help_sessions SET screen_message_id=$3 WHERE owner_user_id=$1 AND revision=$2",
    [ctx.from.id,next.revision,view.messageId]);
 });
}
