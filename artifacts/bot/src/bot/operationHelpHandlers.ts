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
  "🪪 <b>プロフ｜自分の紹介ページを作る</b>",
  "好きなことや自分の情報を紹介できます。保存・投稿すると、3つの掲示板の「みんなのプロフ」に表示されます。すでに投稿している場合は、同じ投稿を更新します。",
  "",
  "📝 <b>① 基本情報を入力する</b>",
  "➔ 下の［▶ この機能を開く］をタップします。",
  "➔ 画面の案内に沿って、次の例のように改行して1回で送ります。",
  "<b>✏️ 入力例</b>",
  "<code>自己紹介\nゼロ\n175 80 40\n映画や旅行が好きです。</code>",
  "1行目＝タイトル／2行目＝ニックネーム／3行目＝身長(cm)・体重(kg)・年齢(歳)／4行目以降＝自己紹介文です。",
  "➔ 入力した内容が画面に表示されます。違う内容に直したいときは、入力し直してください。",
  "",
  "💖 <b>② ポジション・好きなことを選ぶ</b>",
  "➔ ［ポジション］を押し、自分に合う項目を選びます。",
  "➔ ［#Like］を押す → 分類を選ぶ → 当てはまる項目を押す → ［保存］で戻ります。",
  "➔ ［#Love］も同様に、相手に求めることを選びます。選んだ項目は画面で確認できます。",
  "",
  "🖼️ <b>③ 写真・動画を登録する（任意）</b>",
  "➔ ［🖼️🎬 アルバム］を押し、写真や動画を送ります。合わせて5件まで登録できます。",
  "➔ ［🖼️アルバムを見る］で内容を確認できます。",
  "➔ 入れ替えたい場合は「差替 1」、削除したい場合は「削除 1」のように、表示された番号を入力します。",
  "➔ ［↩ 戻る］で元の画面に戻ります。",
  "",
  "📍 <b>④ 容姿・エリアを設定する（任意）</b>",
  "➔ ［容姿/エリア］を押す → ［髪型］［体型］［エリア］から変更したい項目を選びます。",
  "➔ 内容を確認して［保存］を押します。",
  "",
  "✅ <b>⑤ 保存・投稿する</b>",
  "➔ プロフィールの内容を見直します。",
  "➔ ［✅ 保存・3掲示板へ投稿］を押すと、保存と掲示板への投稿・更新を行います。",
  "➔ やめる場合は［キャンセル］を押します。保存済みのプロフィールや公開済み投稿まで削除する操作ではありません。",
  "⚠️ <b>ご注意</b>：登録にはTelegramのユーザー名が必要です。投稿できたか不明な場合は、画面に表示された結果を確認してください。"
 ].join("\n"),
 room:[
  "🎬 <b>募集+Room｜相手募集とビデオチャット</b>",
  "相手を募集しながら、ビデオチャットを開催できます。今すぐ始める方法と、日時を決めて予告する方法があります。",
  "",
  "🚪 <b>① Roomの準備方法を選ぶ</b>",
  "➔ 下の［▶ この機能を開く］を押します。",
  "➔ ［Room作成］は、このBotから新しく通話場所を作る方法です。",
  "➔ ［Room持ち込み］は、自分で用意した通話場所を使う方法です。参加用の「https://」で始まるリンクを送ります。",
  "",
  "📝 <b>② 募集内容を入力する</b>",
  "➔ 画面の案内に沿い、タイトル・ニックネーム・身長・体重・年齢・募集文を入力します。登録済みのプロフを使う場合は、その案内に従います。",
  "➔ ［ポジション］で自分のタイプを選びます。",
  "➔ ［#Like］［#Love］で好きなことや希望を選び、選択後は元の画面へ戻ります。",
  "➔ ［🪪 プロフ登録］からプロフィールも作れます。",
  "",
  "🕒 <b>③ 開催するタイミングを選ぶ</b>",
  "➔ ［▶ 即開始］：内容を確認して投稿し、Roomを開始する方法です。",
  "➔ ［📅 予告する］：日時を決めて、先に参加者を募集する方法です。",
  "➔ 予告する場合は［自由参加］または［承認制］を選びます。",
  "➔ 日付を選ぶ → 時間を選ぶ → 分を選びます。直接日時を入力できる案内が表示された場合は、その入力方法も利用できます。",
  "",
  "👀 <b>④ 内容を確認して投稿する</b>",
  "➔ 表示された募集文、日時、参加方法を確認します。",
  "➔ 予告では［✅ 投稿する］、投稿確認画面では［✅ この内容で投稿］を押します。",
  "➔ ［↩ 戻る］で修正できます。［キャンセル］は作成中の操作を中止します。",
  "",
  "🔴 <b>⑤ 開催・終了を操作する</b>",
  "➔ 投稿後の管理画面から開始・入室します。",
  "➔ 開催中は掲示板の表示が「LIVE中」に変わり、終了操作後は「終了」に切り替わります。",
  "➔ 承認制では、参加希望者を確認して承認・拒否します。",
  "💡 <b>覚えておこう</b>：投稿しただけで通話が始まるとは限りません。開始と終了は管理画面で操作してください。"
 ].join("\n"),
 announcement:[
  "📢 <b>告知/予告｜予定やイベントを知らせる</b>",
  "開催することや予定を掲示板にお知らせできます。途中で保存して、後から続きを編集することもできます。",
  "",
  "📝 <b>① 内容を書く</b>",
  "➔ 下の［▶ この機能を開く］をタップします。",
  "➔ ［📢 告知］なら通常のお知らせ、［📅 予告］なら開催日時を知らせる投稿を選びます。",
  "➔ ［📝 本文編集］を押し、お知らせしたい文章を送ります。",
  "➔ 内容を入力すると、元の画面で確認できます。修正したいときは［📝 本文編集］から書き直せます。",
  "",
  "📅 <b>② 開催日時を設定する（予告の場合）</b>",
  "➔ ［📅 日時・受付］を押します。",
  "➔ 日本時間で日時を送ります。<b>✏️ 入力例：</b><code>2026/12/05 20:00</code>",
  "➔ 入力後、画面で日時を確認します。予告は開催日時が必要です。",
  "",
  "📍 <b>③ 必要な設定を確認する</b>",
  "➔ ［📍 投稿先］から、掲載する掲示板を選びます。",
  "➔ 画面に［🔗 プロフ連携］がある場合、登録済みの公開プロフィールを案内に付けるか選べます。プロフィールがない場合は選択できません。",
  "➔ 投稿する文章や投稿先を確認します。",
  "",
  "✅ <b>④ 保存するか、投稿する</b>",
  "➔ 後で続けるなら［下書き保存］。この時点では掲示板に公開されません。",
  "➔ 公開するなら［✅ 投稿］を押し、投稿先を確認して進みます。",
  "➔ ［キャンセル］で今回の作成を中止できます。以前保存した下書きはそのまま残ります。",
  "⚠️ <b>ご注意</b>：予告では本文と日時を入れてから投稿してください。投稿先を決めずに別の掲示板へ自動公開することはありません。"
 ].join("\n"),
 link:[
  "🔗 <b>ボタン作成｜タップで開けるリンクを付ける</b>",
  "文章や写真・動画と一緒に、好きなページへ移動できるボタンを作れます。例えば「詳しく見る」を押すと指定のページを開く投稿です。",
  "",
  "🖼️ <b>① 一緒に載せる内容を送る</b>",
  "➔ 下の［▶ この機能を開く］を押します。",
  "➔ 文章・写真・動画など、ボタンと一緒に表示したい内容を送ります。写真や動画の説明は、送信時の説明欄に入力できます。",
  "➔ 受け付けた内容を確認したら、ボタンの名前と移動先を入力します。",
  "",
  "✏️ <b>② 最初のボタンを作る</b>",
  "➔ 次の例のように、<b>名前とURLを2行に分けて1回で</b>送信します。",
  "<b>入力例</b>",
  "<code>詳しく見る\nhttps://example.com</code>",
  "1行目＝ボタンに表示する名前／2行目＝押したときに開くURLです。",
  "➔ 必要に応じて［標準］［青］［緑］［赤］からボタンの色を選びます。",
  "",
  "➕ <b>③ ボタンを追加する</b>",
  "➔ プレビューの［ボタンの追加］を選びます。",
  "➔ ［▶］は今あるボタンの右側へ、［▼］は次の段へ追加します。",
  "➔ 追加するボタンの名前とURLを、同じ2行形式で送ります。",
  "➔ 追加したボタンはプレビューで位置と文字を確認できます。",
  "",
  "🛠️ <b>④ 内容や並びを修正する</b>",
  "➔ プレビュー内の［内容の編集］や、変更したい項目の［編集］を選びます。",
  "➔ 本文・写真や動画・ボタン名・URLなど、直したい部分だけを変更できます。",
  "➔ 写真や動画に文章を付けた場合は［上に表示］［下に表示］で位置を選べます。",
  "➔ ［戻る］でプレビューへ戻り、変更後の状態を確認します。",
  "",
  "✅ <b>⑤ 登録する</b>",
  "➔ 名前・移動先・並び・一緒に載せる内容を確認します。",
  "➔ ［登録］を押して確定します。［キャンセル］なら登録せず戻ります。",
  "➔ 登録後は［📋 登録コードをコピー］でコードをコピーでき、［編集］や［新規作成］も選べます。",
  "⚠️ <b>ご注意</b>：リンク先のURLを間違えると、押した人が正しいページへ移動できません。登録前に確認してください。"
 ].join("\n"),
 search:[
  "🔍 <b>検索/フィルター｜募集やプロフを探す</b>",
  "参加している掲示板の公開済み投稿から、条件に合う相手募集やプロフィールを探せます。検索しても自分の投稿は作られません。",
  "",
  "🎯 <b>① 探すものを選ぶ</b>",
  "➔ 下の［▶ この機能を開く］を押します。",
  "➔ ［プロフ］ならプロフィール、［相手募集］なら募集投稿を探します。",
  "",
  "🔎 <b>② 言葉で探す</b>",
  "➔ ［🔍 キーワード検索］を押します。",
  "➔ 探したい言葉を入力して送ります（80文字以内）。",
  "➔ 画面に入力した言葉が表示されます。言葉を指定せず、条件だけで検索することもできます。",
  "",
  "🎛️ <b>③ 条件を絞り込む</b>",
  "➔ ［🎛 詳細フィルター］を押します。",
  "➔ エリア・ポジションなど、条件を付けたい項目を選びます。",
  "➔ プロフ検索なら［年齢］［髪型］［体型］［#Like］［#Love］も選べます。",
  "➔ 年齢は「35」または「18-49」のように入力します（18〜89歳）。",
  "➔ ［#Like］［#Love］は分類を選ぶ → 項目を選ぶ順番です。項目をもう一度押すと解除できます。",
  "➔ ［↩ 戻る］で条件画面へ戻れます。",
  "",
  "📋 <b>④ 結果を確認する</b>",
  "➔ ［🔎 検索実行］を押します。",
  "➔ 結果は5件ずつ表示されます。見たい投稿の名前を押すと、元の掲示板投稿を開けます。",
  "➔ ［次へ ▶］［◀ 前へ］でほかの結果を見られます。",
  "➔ 探し直すなら［🎛 条件変更］、全条件を消すなら最初の画面で［条件クリア］を押します。",
  "💡 <b>覚えておこう</b>：非公開のプロフィールや下書きは検索に表示されません。"
 ].join("\n")
};

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
 const view=await showWizardScreen(t,id,s.screenMessageId??undefined,text,keyboard,topic===null?undefined:"HTML");
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
