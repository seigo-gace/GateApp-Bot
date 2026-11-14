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
import {startCompactProfileEditor} from "./profileCompactHandlers.js";

type Topic="profile"|"room"|"announcement"|"link"|"search";
type HelpSection=Topic|"home";
type Session={revision:number;section:HelpSection;screenMessageId:number|null};
const SECTION_KEYS:readonly Topic[]=["profile","room","announcement","link","search"];
const sectionLabels:Readonly<Record<Topic,string>>={
 profile:"プロフ",room:"Room+募集",announcement:"告知/予告",
 link:"🔗ボタン作成",search:"検索/フィルター"
};
const sectionText:Readonly<Record<Topic,string>>={
 profile:"🪪 プロフ作成｜使い方\n\n【1 入力する】\n「プロフ作成」を押し、DMに次の順で1通送信します。\n1行目：タイトル\n2行目：ニックネーム\n3行目：身長 体重 年齢（空白区切り）\n4行目以降：自己PR（任意・改行可）\n\n入力例：\n自己紹介\nゼロ\n175 80 40\n気軽に話しかけてください。\n\n【2 ボタンで条件を選ぶ】\n「ポジション」「#Like」「#Love」「目的」「場所」を開き、該当する項目をタップします。選択した項目には✅が付きます。再タップで解除できます。「容姿/エリア」から外見や地域も設定できます。\n\n【3 写真・動画を付ける】\n「🖼️🎬 アルバム」を押し、Telegramの添付から送信します。画像と動画を合計5件まで登録できます。内容の確認は「🖼️アルバムを見る」、差し替えや削除は表示される番号を使います。\n\n【4 登録・投稿する】\n画面の入力済みプレビューを確認し、「✅ 保存・3掲示板へ投稿」を押します。3掲示板の「みんなのプロフ」への反映結果がDMに通知されます。保存後も投稿確認が未完了なら成功とは表示されません。\n\n【別画面からの登録】\n相手募集・募集+Room・応募の「プロフ登録」からも同じ画面へ進めます。既存プロフィールは自動上書きせず、本人の確定操作で更新します。",
 room:"🎬 募集+Room｜使い方\n\n【1 Roomの方式を選ぶ】\n「募集+Room」を押し、Room作成方法を選択します。既存の外部ROOMを使うときはHTTPSの参加URLを送信します。\n\n【2 募集内容を入力する】\n相手募集と同じ入力形式です。\nプロフ未登録：タイトル／ニックネーム／身長 体重 年齢／募集内容の順で1通送信。\nプロフ登録済：タイトル／募集内容を送信。登録情報を連動できます。\nポジション、#Like、#Love、目的、場所は画面の選択ボタンで設定します。\n\n【3 開始方法・参加方式を決める】\n画面から即開始または日時指定の流れを選びます。日時指定では参加方式（自由参加または承認制）と開始日時を設定します。承認制の場合は、募集主が応募者を承認します。\n\n【4 投稿・管理する】\n内容と投稿先を確認し、「投稿する」または最終確認画面の投稿ボタンを押します。投稿後はDMから応募者の確認・承認/拒否、Roomへの入室、終了や削除を操作します。終了後の募集表示と参加導線も終了状態に連動します。\n\n【プロフィールも作る】\n入力中の「🪪 プロフ登録」からプロフィール登録画面へ移動できます。",
 announcement:"📣 告知/予告｜使い方\n\n【1 種類を選ぶ】\n「告知/予告」を押し、画面上段の「📢 告知」か「📅 予告」を選択します。✅の付いた方が選択中です。\n\n【2 本文を入力する】\n「📝 本文編集」を押して、告知内容を1通送信します。予告の場合は「📅 日時・受付」から開催日時や受付条件を設定します。\n\n【3 必要な設定をする】\nプロフィールを載せる場合は「🔗 プロフ連携」を選択します。「📍 投稿先」から実際に投稿する掲示板のトピックを選びます。画面の本文・日時・投稿先を確認してください。\n\n【4 保存または投稿する】\nまだ公開しない場合は「下書き保存」、公開する場合は「✅ 投稿」を押します。「キャンセル」は公開操作ではありません。\n\n【注意】\n告知と予告の違いは、開催日時を設定して案内するかどうかです。投稿前に日時と投稿先を必ず確認してください。",
 link:"🔗 ボタン作成｜使い方\n\n【1 本文とボタンを送る】\n「🔗ボタン作成」を押し、DMに次の形式で1通送信します。\n1行目：投稿本文\n2行目以降：表示名 | https://リンク先\n\n入力例：\n参加はこちらから\nグループへ | https://t.me/example\n案内を見る | https://example.com/guide\n\n【2 表示を調整する】\n送信後のプレビューで「1列」「2列」「3列」を選びます。ボタンを押したときのリンク先と、表示される文字を確認します。「📝 内容を修正」で入力し直せます。\n\n【3 投稿する】\n投稿先を選んでから公開します。公開前の「キャンセル」で作成操作を中止できます。\n\n【注意】\nリンクはHTTPS形式が必要です。HTTP、短縮URL、ローカル宛先は受け付けません。リンクの飛び先は公開前に確認してください。",
 search:"🔍 検索/フィルター｜使い方\n\n【1 検索する対象を決める】\n「検索/フィルター」を押します。「✅ プロフ」または「✅ 相手募集」で検索対象を切り替えます。\n\n【2 検索条件を入れる】\n文字で探す場合は「🔍 キーワード検索」を押し、80文字以内の言葉を1通送信します。条件で探す場合は「🎛 詳細フィルター」を押します。\nプロフ：エリア・年齢・ポジション・体型・髪型・目的・#Like・#Love。\n相手募集：エリア・ポジション・目的。\n項目を選択し、選択済みの✅を確認します。同じ選択肢の再タップで解除できます。\n\n【3 検索する】\n「🔎 検索実行」を押すと、参加済みグループ内の公開投稿が表示されます。1ページ5件で「次へ ▶」「◀ 前へ」で移動し、結果のボタンから元の投稿を開けます。\n\n【4 条件を変える】\n「🎛 条件変更」で絞り直せます。「条件クリア」で指定条件を消し、「↩ 戻る」で前の画面または投稿メニューに戻れます。"
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
 const text=topic===null?"📚 操作説明｜投稿メニュー\n\nこの画面では、各機能の使い方を確認できます。下の「プロフ」「Room+募集」「告知/予告」「🔗ボタン作成」「検索/フィルター」を押すと具体的な入力手順を表示します。\n\n【📝 相手募集】\n① 投稿メニューで「相手募集」を押す。\n② プロフ未登録なら1行目タイトル、2行目ニックネーム、3行目「身長 体重 年齢」、4行目以降に募集内容を入力し、1通送信する。\n　例：今夜遊べる人募集\n　　　ゼロ\n　　　175 80 40\n　　　会える方を探しています。\n③ 登録済みなら1行目タイトル、2行目以降に募集内容を入力。プロフィール情報と連動する。\n④ ポジション・#Like・#Love・目的・場所をボタンで選び、必要なら「プロフ登録」も利用する。\n⑤ プレビューから投稿先を選択して投稿する。投稿後はDMの「編集」「削除」「投稿先を開く」から管理できる。\n\n【💬 雑談】\n「雑談」を押すと3つの掲示板が表示されます。移動先を選んでタップします。「🔙 戻る」で投稿メニューに戻ります。\n\n【🤝 紹介/招待】\n「紹介/招待」を押すと、各掲示板へ案内するリンクが表示されます。まだ承認されていない方は参加質問ゲートへ、承認済みの方は参加先へのリンクを利用します。コピー用のリンクが表示された場合はコピーして共有できます。\n\n【🎬 クリエーター有料ビデオ投稿】\nこのボタンから動画販売用のCreateVdobotへ進みます。動画の登録・価格設定・販売管理は移動先の専用Botで行います。\n\n【📚 操作説明】\n下の項目をタップ → 詳細を読む →「▶ この機能を開く」でその機能へ進む。「↩ 操作説明へ戻る」で一覧に戻ります。最後の「戻る」は投稿メニューへ戻る操作です。":sectionText[topic];
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
