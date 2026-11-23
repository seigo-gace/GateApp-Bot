/** Adopted operation-help layout: three columns × two rows.
 * Reuses the shared wizard screen and exact pre-existing feature editors.
 * Help text is explanatory, never an alternative posting implementation.
 */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {showWizardScreen} from "../services/dmWizardScreen.js";
import {APPROVED_HELP_ROWS} from "../services/menuPanelRenderer.js";
import {editMessageToDmPostingMenu} from "../services/dmPostingMenuRestore.js";
import {startRoomEditor,startAnnouncementEditor,startLinkEditor} from "./postingHandlers.js";

import {startSearchEditor} from "./searchHandlers.js";
import {startCompactProfileEditor} from "./profileCompactHandlers.js";

type Topic="profile"|"room"|"announcement"|"link"|"search";
type HelpSection=Topic|"home";
type Session={revision:number;section:HelpSection;screenMessageId:number|null};
const SECTION_KEYS:readonly Topic[]=["profile","room","announcement","link","search"];
const sectionLabels:Readonly<Record<Topic,string>>={
 profile:"プロフ",room:"Room+募集",announcement:"告知/予告",
 link:"🔗ボタン作成",search:"検索/フィルター"
};
export const sectionText:Readonly<Record<Topic,string>>={
 profile:[
  "🪪 プロフ｜自己紹介を作って公開する",
  "【どんな機能？】相手募集・Room・応募でも使えるプロフィールを作成し、3掲示板の「みんなのプロフ」に投稿・更新できます。内容を保存・投稿する前に編集できます。",
  "",
  "【具体的な操作】",
  "①［▶ この機能を開く］を押すと、今の説明画面がそのまま現行プロフィール入力画面になります。",
  "② 通常のメッセージで「タイトル／ニックネーム／身長 体重 年齢／自己PR」を入力します。例：\n自己紹介\nゼロ\n175 80 40\n趣味や好きなこと",
  "③ ［ポジション］［#Like］［#Love］［目的］［場所］を選びます。選択状態は画面で確認・変更できます。",
  "④ ［🖼️🎬 アルバム］から画像・動画を合計5件まで登録できます。［容姿/エリア］から髪型・体型・エリアを変更できます。",
  "⑤ 内容を確認して［✅ 保存・3掲示板へ投稿］を押すと公開先の「みんなのプロフ」へ投稿・更新します。キャンセルなら投稿しません。",
  "【注意】通常のプロフィール登録では本人の確認なく途中で公開しません。公開済みカードは元の投稿と紐づけて更新します。"
 ].join("\n"),
 room:[
  "🎬 募集+Room｜募集とビデオ通話をまとめる",
  "【どんな機能？】相手募集とRoomを1つの投稿で案内します。今すぐ開催・日時を予告・参加承認制を選べます。",
  "",
  "【具体的な操作】",
  "①［▶ この機能を開く］→［Room作成］または［Room持ち込み］を選びます。作成は既存のJitsi連携、持ち込みは自分の通話URLを使います。",
  "② タイトルと説明・募集内容を入力し、必要なら［ポジション］［#Like］［#Love］や［🪪 プロフ登録］を選びます。",
  "③ ［▶ 即開始］なら公開してからRoomを開始します。［📅 予告する］なら日付・時刻を設定し、［自由参加］か［承認制］を選びます。",
  "④ プレビューと投稿先を確認して［投稿する］を押します。投稿先は検証済みのトピックだけです。",
  "⑤ 開始・終了は投稿後の専用管理ボタンから操作します。掲示板カードのLIVE/終了状態も同じRoomに連動します。",
  "【注意】公開前の［キャンセル］と公開済みRoomの［終了］は別操作です。"
 ].join("\n"),
 announcement:[
  "📢 告知/予告｜イベントや予定を知らせる",
  "【どんな機能？】開催内容を掲示板に知らせたり、日時付きの予告を投稿したりできます。投稿前に下書き保存・内容確認ができます。",
  "",
  "【具体的な操作】",
  "①［▶ この機能を開く］で告知/予告の編集画面に進みます。［📢 告知］または［📅 予告］を選びます。",
  "② ［📝 本文編集］からタイトルや説明を入力します。予告なら［📅 日時・受付］で日時・受付内容を設定します。",
  "③ ［🔗 プロフ連携］でプロフィールを使うか決め、［📍 投稿先］で公開先を選びます。",
  "④ 画面のプレビューで未設定項目・入力内容を確認し、［下書き保存］で中断するか、［✅ 投稿］で公開します。",
  "【注意】未設定の項目は公開文へ無理に表示しません。公開ボタンを押すまでグループへ投稿しません。"
 ].join("\n"),
 link:[
  "🔗 ボタン作成｜投稿にタップできるリンクを付ける",
  "【どんな機能？】文章・画像・動画などの投稿にURLボタンを付け、閲覧者がリンク先を開ける投稿を作ります。",
  "",
  "【具体的な操作】",
  "①［▶ この機能を開く］で本文・画像・動画など、ボタンと一緒に投稿する素材を送ります。不要な項目は無理に作らなくて構いません。",
  "② ボタン追加時は「ボタン名」と「https://で始まるURL」を2行で送ります。例：\n詳しく見る\nhttps://example.com",
  "③ 2個目以降は［▶］で右に追加、［▼］で次の行へ追加で横並び・次の行を決めます。ボタン色・表示位置は既存の選択画面で設定します。",
  "④ 画面内の［編集］から本文・メディア・各ボタンを変更し、プレビューで表示名・URL・並び順を確認します。",
  "⑤ ［登録］で確定し、用意された投稿コードと投稿先を確認します。［キャンセル］は未登録の変更を取り消します。",
  "【注意】作成済みの投稿を編集する場合は元の投稿・登録情報を保持します。"
 ].join("\n"),
 search:[
  "🔍 検索/フィルター｜公開された募集・プロフから探す",
  "【どんな機能？】参加先の掲示板にある公開済み相手募集・プロフィールから、条件に合う投稿を探せます。検索では投稿しません。",
  "",
  "【具体的な操作】",
  "①［▶ この機能を開く］→［プロフ］か［相手募集］を選びます。",
  "② ［🔍 キーワード検索］で文字を入力し、必要なら［🎛 詳細フィルター］でエリア・ポジション・目的を選びます。",
  "③ プロフ検索では年齢・体型・髪型・#Like・#Loveでも絞り込めます。［条件クリア］で選択を戻せます。",
  "④ ［🔎 検索実行］で結果を5件ずつ表示し、［前へ］［次へ］で移動。結果の投稿ボタンから元の投稿へ進めます。",
  "【注意】参加済みグループの公開済み情報が対象です。本人の未公開プロフィールや下書きは検索に出ません。"
 ].join("\n")
}
export function helpHomeKeyboard(rev:number){
 return Markup.inlineKeyboard(APPROVED_HELP_ROWS.map(row=>row.map(label=>
  Markup.button.callback(label,label==="戻る"?`help:back:${rev}`:
    `help:topic:${rev}:${SECTION_KEYS.find(key=>sectionLabels[key]===label)}`))));
}
/** Returning within an existing DM must be a callback, never ?start. */
export function helpReturnToPostingKeyboard(){
 return Markup.inlineKeyboard([[
  Markup.button.callback("↩ 投稿メニュー","dm:utility:home"),
 ]]);
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
async function begin(id:number,sourceScreenId?:number):Promise<Session>{
 const screenId=Number.isSafeInteger(sourceScreenId)&&Number(sourceScreenId)>0?sourceScreenId:null;
 const r=await pool.query(`INSERT INTO gaybbs_help_sessions(owner_user_id,screen_message_id)
  VALUES($1,$2) ON CONFLICT(owner_user_id) DO UPDATE SET
   section='home',revision=gaybbs_help_sessions.revision+1,
   screen_message_id=COALESCE(EXCLUDED.screen_message_id,gaybbs_help_sessions.screen_message_id),
   updated_at=NOW()
   RETURNING revision,section,screen_message_id`,[id,screenId]);
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
export async function startOperationHelp(t:Telegram,id:number,sourceScreenId?:number):Promise<void>{
 const s=await begin(id,sourceScreenId);
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
  if(topic==="profile")await startCompactProfileEditor(ctx);
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
  // The same already-open DM screen must become the CURRENT full posting menu.
  // Do not show a dead-end page or emit an old ?start link when origin expired.
  await editMessageToDmPostingMenu(ctx,ctx.from.id);
 });
}
