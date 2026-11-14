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

type Topic="profile"|"room"|"announcement"|"link"|"search"|"recruit"|"chat"|"invite"|"paid";
type HelpSection=Topic|"home"|"tags";
type Session={revision:number;section:HelpSection;screenMessageId:number|null};
const SECTION_KEYS:readonly Topic[]=["profile","room","announcement","link","search","recruit","chat","invite","paid"];
const sectionLabels:Readonly<Record<Topic,string>>={
 profile:"プロフ",room:"Room+募集",announcement:"告知/予告",
 link:"🔗ボタン作成",search:"検索/フィルター",
 recruit:"相手募集",chat:"雑談",invite:"紹介/招待",paid:"有料ビデオ"
};
const sectionText:Readonly<Record<Topic,string>>={
 profile:"🪪 プロフ作成｜使い方\n\n【1 入力する】\n「プロフ作成」を押し、DMに次の順で1通送信します。\n1行目：タイトル\n2行目：ニックネーム\n3行目：身長 体重 年齢（空白区切り）\n4行目以降：自己PR（任意・改行可）\n\n入力例：\n自己紹介\nゼロ\n175 80 40\n気軽に話しかけてください。\n\n【2 ボタンで条件を選ぶ】\n「ポジション」「#Like」「#Love」「目的」「場所」を開き、該当する項目をタップします。 #Like（緑）は自分の特徴・好み、#Love（赤）は相手に求める特徴・好みです。6分類から該当する言葉を複数選択し、「✅ 保存」で確定します。下の「🏷️ #Like・#Loveの説明」で詳しく確認できます。選択した項目には✅が付きます。再タップで解除できます。「容姿/エリア」から外見や地域も設定できます。\n\n【3 写真・動画を付ける】\n「🖼️🎬 アルバム」を押し、Telegramの添付から送信します。画像と動画を合計5件まで登録できます。内容の確認は「🖼️アルバムを見る」、差し替えや削除は表示される番号を使います。\n\n【4 登録・投稿する】\n画面の入力済みプレビューを確認し、「✅ 保存・3掲示板へ投稿」を押します。3掲示板の「みんなのプロフ」への反映結果がDMに通知されます。保存後も投稿確認が未完了なら成功とは表示されません。\n\n【別画面からの登録】\n相手募集・募集+Room・応募の「プロフ登録」からも同じ画面へ進めます。既存プロフィールは自動上書きせず、本人の確定操作で更新します。",
 room:"🎬 募集+Room｜使い方\n\n【1 Roomの方式を選ぶ】\n「募集+Room」を押し、Room作成方法を選択します。既存の外部ROOMを使うときはHTTPSの参加URLを送信します。\n\n【2 募集内容を入力する】\n相手募集と同じ入力形式です。\nプロフ未登録：タイトル／ニックネーム／身長 体重 年齢／募集内容の順で1通送信。\nプロフ登録済：タイトル／募集内容を送信。登録情報を連動できます。\nポジション、#Like、#Love、目的、場所は画面の選択ボタンで設定します。 #Like（緑）＝自分の特徴・好み、#Love（赤）＝相手への希望です。分類を開いて複数のタグを選び、「✅ 保存」で確定します。詳しくは下の「🏷️ #Like・#Loveの説明」を押してください。\n\n【3 開始方法・参加方式を決める】\n画面から即開始または日時指定の流れを選びます。日時指定では参加方式（自由参加または承認制）と開始日時を設定します。承認制の場合は、募集主が応募者を承認します。\n\n【4 投稿・管理する】\n日時指定では内容と投稿先を確認し、最終確認画面の投稿ボタンを押します。即開始の場合は選択によってそのまま投稿処理へ進むため、選ぶ前に内容を確認してください。投稿後はDMから応募者の確認・承認/拒否、Roomへの入室、終了や削除を操作します。終了後の募集表示と参加導線も終了状態に連動します。\n\n【プロフィールも作る】\n入力中の「🪪 プロフ登録」からプロフィール登録画面へ移動できます。",
 announcement:"📣 告知/予告｜使い方\n\n【1 種類を選ぶ】\n「告知/予告」を押し、画面上段の「📢 告知」か「📅 予告」を選択します。✅の付いた方が選択中です。\n\n【2 本文を入力する】\n「📝 本文編集」を押して、告知内容を1通送信します。予告の場合は「📅 日時・受付」から開催日時や受付条件を設定します。\n\n【3 必要な設定をする】\nプロフィールを載せる場合は「🔗 プロフ連携」を選択します。「📍 投稿先」から実際に投稿する掲示板のトピックを選びます。画面の本文・日時・投稿先を確認してください。\n\n【4 保存または投稿する】\nまだ公開しない場合は「下書き保存」、公開する場合は「✅ 投稿」を押します。「キャンセル」は公開操作ではありません。\n\n【注意】\n告知と予告の違いは、開催日時を設定して案内するかどうかです。投稿前に日時と投稿先を必ず確認してください。",
 link:"🔗 ボタン作成｜使い方\n\n【1 本文とボタンを送る】\n「🔗ボタン作成」を押し、DMに次の形式で1通送信します。\n1行目：投稿本文\n2行目以降：表示名 | https://リンク先\n\n入力例：\n参加はこちらから\nグループへ | https://t.me/example\n案内を見る | https://example.com/guide\n\n【2 表示を調整する】\n送信後のプレビューで「1列」「2列」「3列」を選びます。ボタンを押したときのリンク先と、表示される文字を確認します。「📝 内容を修正」で入力し直せます。\n\n【3 投稿する】\n投稿先を選んでから公開します。公開前の「キャンセル」で作成操作を中止できます。\n\n【注意】\nリンクはHTTPS形式が必要です。HTTP、短縮URL、ローカル宛先は受け付けません。リンクの飛び先は公開前に確認してください。",
 search:"🔍 検索/フィルター｜使い方\n\n【1 検索する対象を決める】\n「検索/フィルター」を押します。「✅ プロフ」または「✅ 相手募集」で検索対象を切り替えます。\n\n【2 検索条件を入れる】\n文字で探す場合は「🔍 キーワード検索」を押し、80文字以内の言葉を1通送信します。条件で探す場合は「🎛 詳細フィルター」を押します。\nプロフ：エリア・年齢・ポジション・体型・髪型・目的・#Like・#Love。\n相手募集：エリア・ポジション・目的。\n項目を選択し、選択済みの✅を確認します。同じ選択肢の再タップで解除できます。\n\n【3 検索する】\n「🔎 検索実行」を押すと、参加済みグループ内の公開投稿が表示されます。1ページ5件で「次へ ▶」「◀ 前へ」で移動し、結果のボタンから元の投稿を開けます。\n\n【4 条件を変える】\n「🎛 条件変更」で絞り直せます。「条件クリア」で指定条件を消し、「↩ 戻る」で前の画面または投稿メニューに戻れます。",
 recruit:"📝 相手募集｜どんな機能？\n\n同じ掲示板のメンバーへ、会いたい相手・したいこと・希望条件を伝えて応募を受け付ける機能です。Roomを作らない通常の募集に使います。\n\n【1 募集を作る】\n投稿メニューで「相手募集」を押します。DMで入力画面が開きます。\n\n【2 文章を入力する】\nプロフ未登録なら、1通のメッセージを以下の順で送ります。\n1行目：募集タイトル\n2行目：ニックネーム\n3行目：身長 体重 年齢（空白で区切る）\n4行目以降：募集内容（改行可）\n\n例：\n今夜遊べる人募集\nゼロ\n175 80 40\n近くで会える人を探しています。\n\n登録済みプロフを利用する場合は、1行目タイトル・2行目以降募集内容だけです。保存した基本情報を連動します。\n\n【3 ボタンで条件を選ぶ】\n「ポジション選択」「#Like」（緑）「#Love」（赤）「目的」「場所」を順に開きます。\n#Like＝自分の特徴・好み、#Love＝希望する相手の特徴・好み。6カテゴリから当てはまるタグを押します。複数選択でき、✅は選択中。同じタグをもう一度押すと解除します。最後に「✅ 保存」を押します。\n「目的」は募集の目的、「場所」は場所あり・なしや移動条件などです。\nプロフィールを登録したい場合は「🪪 プロフ登録」から移動できます。\n\n【4 投稿する】\n画面に反映されたプレビューで内容を確かめ、「✅ 投稿する」を押します。投稿先の選択画面が出たら、目的の掲示板・トピックを選択してください。\n\n【5 投稿後】\nDMの「✏️ 編集」「🗑 削除」「📍 投稿先を開く」で自分の募集を管理できます。編集は既存投稿の差し替え、削除は本人の投稿だけです。",
 chat:"💬 雑談｜どんな機能？\n\n3つの掲示板の雑談トピックへ移動し、参加者と自由に会話するための入口です。募集の作成画面ではありません。\n\n【使い方】\n① 投稿メニューで「雑談」を押します。\n② 次の3つの移動先ボタンから話したい掲示板を選びます。\n・ビデオChatの掲示板\n・エリア’s BBS\n・ゲイのための掲示板♂\n③ 選んだリンクを開くと、指定された雑談投稿へ移動します。\n④ 移動をやめる場合は「🔙 戻る」を押し、投稿メニューに戻ります。\n\n【注意】\nここで選ぶのは移動先の掲示板です。メッセージ送信や投稿は移動先のTelegram画面で行います。",
 invite:"🤝 紹介/招待｜どんな機能？\n\n3つの掲示板への参加リンクを案内したり、友人へ紹介するための機能です。\n\n【使い方】\n① 投稿メニューで「紹介/招待」を押します。\n② あなたの参加承認状況に応じたリンクが表示されます。\n③ 未承認の人は、まず参加質問ゲートへ進み、参加資格・規約・グループルールの質問に回答します。\n④ 承認済みの人は各掲示板の参加リンクを選べます。\n⑤ コピー用ボタンが表示されたときは、そのボタンを押してリンクをコピーし、紹介する相手へ貼り付けます。\n⑥ 「🔙 戻る」で投稿メニューに戻れます。\n\n【注意】\n参加質問の回答をせずに管理者の個別承認を依頼する操作ではありません。リンクは受取人の承認状況に合った入口を使ってください。",
 paid:"🎬 クリエーター有料ビデオ投稿｜どんな機能？\n\n動画をTelegram Starsで販売したいクリエーター向けの入口です。募集や雑談の投稿とは異なり、動画の管理は専用のCreateVdobotで行います。\n\n【基本の流れ】\n① 投稿メニューの「クリエーター有料ビデオ投稿」を押し、専用Botへのリンクを開きます。\n② 専用Botの「🎬 動画を投稿」から作品を登録します。\n③ タイトル・サムネイル・サンプル動画など必要な内容を設定します。サンプルは最大30秒の仕様です。\n④ Stars価格を選択し、購入者が内容と価格を確認できる状態にします。\n⑤ 登録後は「📦 マイ動画」から作品の編集や削除を行います。「💰 売上・出金」から売上を確認します。\n\n【販売時の注意】\n販売手数料は30%の設計です。販売・決済・出金の現在の利用可否は専用Botの画面で確認してください。操作説明だけで販売完了や決済成功にはなりません。"
};
export const TAG_HELP_TEXT="🏷️ #Like と #Love｜違いと選び方\n\n【何を設定するもの？】\n🟢 #Like＝自分自身の特徴・好み・趣味・スタイル。\n🔴 #Love＝相手に求める特徴・好み・趣味・スタイル。\n同じ言葉でも「自分のこと」か「相手への希望」かで意味が変わります。\n\n【どこで使う？】\n「相手募集」「募集+Room」「プロフ作成」の入力画面にある「#Like」「#Love」から設定します。Room応募でも同じタグの選択画面を使います。\n\n【具体的な選び方】\n① 緑の「#Like」または赤の「#Love」を押します。\n② 6分類「エロワード」「パーツ」「プレイ」「雰囲気/外見」「着衣/装備」「性感帯」から分類を選びます。\n③ 候補の言葉をタップします。▫️が✅になれば選択済みです。\n④ 複数選択できます。もう一度タップすると、その項目だけ解除されます。\n⑤ 候補が多いときは「次 ➡️」で次のページ、「↩ 戻る」で前のページまたは分類に戻ります。\n⑥ 「✅ 保存」を押して元の入力画面に戻り、✅ #Like／✅ #Loveを確認します。\n\n【例】\n自分の好きな服装が「スーツ」なら、#Like →「着衣/装備」→「スーツ」を選択。\n相手に「年上好き」のような希望を伝えたいときは、#Love →「雰囲気/外見」から選択。\n実際に自分や相手に当てはまるものだけ選んでください。\n\n【修正するには】\n選択済みの言葉をもう一度押せば解除できます。「キャンセル」は選択操作を中止するときに使います。タグ選択だけで投稿されることはありません。\n\n覚え方：#Like＝自分、#Love＝相手への希望。";
export function helpHomeKeyboard(rev:number){
 const rows=[...APPROVED_HELP_ROWS.map(row=>[...row]),["相手募集","雑談"],["紹介/招待","有料ビデオ"]];
 return Markup.inlineKeyboard(rows.map(row=>row.map(label=>
  Markup.button.callback(label,label==="戻る"?`help:back:${rev}`:
    `help:topic:${rev}:${SECTION_KEYS.find(key=>sectionLabels[key]===label)}`))));
}
export function helpSectionKeyboard(rev:number,section:Topic){
 return Markup.inlineKeyboard([
  ...(section==="profile"||section==="room"?[[Markup.button.callback("🏷️ #Like・#Loveの説明",`help:tags:${rev}`)]]:[]),
  ...(["profile","room","announcement","link","search"].includes(section)?[[Markup.button.callback("▶ この機能を開く",`help:open:${rev}:${section}`)]]:[]),
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
 const topic=s.section==="home"||s.section==="tags"?null:s.section;
 const text=s.section==="tags"?TAG_HELP_TEXT:topic===null?"📚 操作説明｜投稿メニュー\n\nこの画面では、各機能の使い方を確認できます。下の「プロフ」「Room+募集」「告知/予告」「🔗ボタン作成」「検索/フィルター」を押すと具体的な入力手順を表示します。\n\n【📝 相手募集】\n① 投稿メニューで「相手募集」を押す。\n② プロフ未登録なら1行目タイトル、2行目ニックネーム、3行目「身長 体重 年齢」、4行目以降に募集内容を入力し、1通送信する。\n　例：今夜遊べる人募集\n　　　ゼロ\n　　　175 80 40\n　　　会える方を探しています。\n③ 登録済みなら1行目タイトル、2行目以降に募集内容を入力。プロフィール情報と連動する。\n④ ポジション・#Like・#Love・目的・場所を選びます。#Like（緑）は自分の特徴・好み、#Love（赤）は相手への希望。分類から項目を選択し「✅ 保存」で確定します。必要なら「プロフ登録」も利用します。\n⑤ プレビューから投稿先を選択して投稿する。投稿後はDMの「編集」「削除」「投稿先を開く」から管理できる。\n\n【💬 雑談】\n「雑談」を押すと3つの掲示板が表示されます。移動先を選んでタップします。「🔙 戻る」で投稿メニューに戻ります。\n\n【🤝 紹介/招待】\n「紹介/招待」を押すと、各掲示板へ案内するリンクが表示されます。まだ承認されていない方は参加質問ゲートへ、承認済みの方は参加先へのリンクを利用します。コピー用のリンクが表示された場合はコピーして共有できます。\n\n【🎬 クリエーター有料ビデオ投稿】\nこのボタンから動画販売用のCreateVdobotへ進みます。動画の登録・価格設定・販売管理は移動先の専用Botで行います。\n\n【📚 操作説明】\n下の項目をタップ → 詳細を読む →「▶ この機能を開く」でその機能へ進む。「↩ 操作説明へ戻る」で一覧に戻ります。最後の「戻る」は投稿メニューへ戻る操作です。":sectionText[topic];
 const keyboard=s.section==="tags"?Markup.inlineKeyboard([[Markup.button.callback("↩ 操作説明へ戻る",`help:home:${s.revision}`)]]):topic===null?helpHomeKeyboard(s.revision):helpSectionKeyboard(s.revision,topic);
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
 bot.action(/^help:(topic|open):(\d+):(profile|room|announcement|link|search|recruit|chat|invite|paid)$/,async ctx=>{
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
  if(!["profile","room","announcement","link","search"].includes(topic)){
   await ctx.answerCbQuery("投稿メニューからこの機能を開いてください。");return;
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
 bot.action(/^help:tags:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const rev=Number(ctx.match[1]),session=await load(ctx.from.id);
  if(!session||session.revision!==rev||!(session.section==="profile"||session.section==="room")){
   await ctx.answerCbQuery("古い操作です。操作説明から開き直してください。");return;
  }
  await ctx.answerCbQuery();
  await show(ctx.telegram,ctx.from.id,await advance(ctx.from.id,rev,"tags"));
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
