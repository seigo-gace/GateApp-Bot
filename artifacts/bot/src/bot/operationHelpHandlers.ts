/** Adopted operation-help layout: three columns × two rows.
 * Reuses the shared wizard screen and exact pre-existing feature editors.
 * Help text is explanatory, never an alternative posting implementation.
 */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {showWizardScreen} from "../services/dmWizardScreen.js";
import {APPROVED_POSTING_ROWS} from "../services/menuPanelRenderer.js";
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
 recruit:"相手募集",chat:"雑談",invite:"紹介/招待",paid:"クリエーター有料ビデオ投稿"
};
const sectionText:Readonly<Record<Topic,string>>={
 recruit:"📝 相手募集｜相手を探して投稿する\n\n【何をする機能？】\n会いたい人、話したい人などを募集し、掲示板で応募を受け付けます。Roomは作らず、通常の募集を投稿します。\n\n【① 募集内容を入力】\n「相手募集」を押してDMを開きます。\nプロフ未登録の人は次の形で1通送信します。\n\n1行目：募集タイトル\n2行目：ニックネーム\n3行目：身長 体重 年齢\n4行目以降：募集内容\n\n例：\n今夜会える人を募集\nゼロ\n175 80 40\n近くで話せる人を探しています。\n\nプロフ登録済みなら、1行目タイトル・2行目以降募集内容だけで入力できます。\n\n【② 条件をボタンで選ぶ】\nポジション／#Like／#Love／目的／場所を選びます。\n🟢 #Like＝自分の特徴や好み\n🔴 #Love＝相手に希望する特徴や好み\nタグは分類→言葉の順にタップ。✅は選択中、再タップで解除。「✅ 保存」で戻ります。\n目的は「何をしたいか」、場所は「どこで・移動できるか」の条件です。\n\n【③ 投稿】\n画面のプレビューで間違いがないか確認し、「✅ 投稿する」→投稿先のトピックを選びます。\n\n【④ 投稿後】\nDMの「✏️ 編集」「🗑 削除」「📍 投稿先を開く」で管理します。本人の投稿だけ変更できます。途中でプロフィールも登録できます。",
 room:"🎬 募集+Room｜通話・Roomの参加者を募集\n\n【何をする機能？】\n募集文と一緒に参加用Roomを用意し、応募者・参加者を管理する機能です。普通の「相手募集」と異なり、開始・終了や入室の操作があります。\n\n【① Roomを決める】\n「募集+Room」を押し、Room作成方法を選びます。外部Roomを使う場合はHTTPSの参加URLを送ります。\n\n【② 募集文を入力】\nプロフ未登録：タイトル／ニックネーム／身長 体重 年齢／募集内容の順に1通で送信。\n登録済み：タイトルと募集内容を送信。プロフィール情報を連動できます。\n\n【③ 条件を選ぶ】\nポジション／#Like／#Love／目的／場所を設定します。\n🟢 #Like＝自分の特徴・好み\n🔴 #Love＝相手に求める特徴・好み\n分類を開き、タグを複数選択→「✅ 保存」。再タップで解除できます。詳しくは下の「#Like・#Loveの説明」を参照してください。\n\n【④ 開始方法を選ぶ】\n「即開始」は選択後に投稿処理へ進む場合があります。選ぶ前に内容を確認してください。\n日時指定の場合は、開始日・時刻、自由参加または承認制を選びます。\n\n【⑤ 投稿後の操作】\nDMから「応募者を見る」で応募状況を確認。承認制では応募者ごとに承認・拒否を行います。\n「開始して入室」でRoomへ移動し、終了操作後はLIVE表示・参加導線も終了状態に変わります。自分の投稿は削除できます。",
 announcement:"📣 告知/予告｜予定を掲示板に知らせる\n\n【何をする機能？】\nメンバーへお知らせを届ける「告知」と、これからの予定・開催時刻を知らせる「予告」を作る機能です。\n\n【① 種類を選ぶ】\n「告知/予告」を押して、「📢 告知」または「📅 予告」を選びます。✅が付いた方が選択中です。\n\n【② 内容を書く】\n「📝 本文編集」を押して案内文を1通送信します。\n例：今夜の交流会のお知らせ。参加希望の方は募集内容をご確認ください。\n\n【③ 日時と投稿先】\n予告では「📅 日時・受付」から開催日時・受付内容を設定します。\n「🔗 プロフ連携」は自分のプロフィールを付ける設定です。\n「📍 投稿先」から掲示板の投稿先トピックを選びます。\n\n【④ 保存・公開】\n本文・日時・投稿先を確認して「✅ 投稿」で公開します。あとで作業を続けたいときは「下書き保存」。「キャンセル」は投稿しません。\n\n【確認ポイント】\n予告は予定日時を間違えないようにしてください。送信しただけではなく、最終の投稿ボタンで公開します。",
 profile:"🪪 プロフ作成｜自分を紹介する\n\n【何をする機能？】\nニックネーム、体格、好み、地域、写真・動画をまとめた自己紹介です。保存後は3掲示板の「みんなのプロフ」へ反映します。相手募集やRoomの情報にも利用できます。\n\n【① 文章を入力】\n「プロフ作成」を押し、次の順で1通送信します。\n1行目：タイトル\n2行目：ニックネーム\n3行目：身長 体重 年齢\n4行目以降：自己PR（改行可）\n\n例：\n自己紹介\nゼロ\n175 80 40\n気軽に話しかけてください。\n\n【② 条件とタグを選ぶ】\nポジション／#Like／#Love／目的／場所をボタンで設定します。\n🟢 #Like＝自分の特徴・好み・趣味\n🔴 #Love＝相手に希望する特徴・好み\n分類を選ぶ→タグをタップ→✅で選択確認→「✅ 保存」。同じタグを再タップすると解除できます。\n「容姿/エリア」から外見や地域も設定できます。詳しいタグ操作は下の説明ボタンへ。\n\n【③ アルバム登録】\n「🖼️🎬 アルバム」から写真・動画を合計5件まで添付します。「🖼️アルバムを見る」で確認し、「差替 番号」「削除 番号」で変更できます。\n\n【④ 保存・公開】\n入力済みプレビューを確認して「✅ 保存・3掲示板へ投稿」を押します。投稿結果がDMに表示されます。\n\n【ほかの入口】\n相手募集、募集+Room、応募中の「プロフ登録」からも作成できます。既存プロフは自動上書きされません。",
 paid:"🎬 有料ビデオ投稿｜自分の作品を販売する\n\n【何をする機能？】\n動画をTelegram Starsの価格で販売し、販売した作品や売上を専用Botで管理します。\n\n【① 専用Botを開く】\n投稿メニューの「クリエーター有料ビデオ投稿」を押し、CreateVdobotへ移動します。\n\n【② 動画を登録】\n「🎬 動画を投稿」を選び、タイトル、動画、サムネイル、30秒以内のサンプルなどを登録します。案内に沿って素材を送信してください。\n\n【③ Stars価格を決める】\n用意された価格ボタン、または自由入力で価格を設定します。サンプルと価格を確認して公開します。\n\n【④ 販売後】\n「📦 マイ動画」から作品を確認・編集・削除できます。「💰 売上・出金」から売上残高を確認します。\n\n【注意】\n販売手数料は30%の設計です。専用Bot側の販売画面で、購入者が見る内容と価格を確認してください。",
 link:"🔗 ボタン作成｜リンク付きの投稿を作る\n\n【何をする機能？】\n本文の下に、押すと指定したページへ移動できるボタンを付けます。グループへの案内や外部ページの紹介に使います。\n\n【① 本文とリンクを入力】\n「🔗ボタン作成」を押し、DMに次の形で1通送信します。\n\n1行目：投稿本文\n2行目以降：ボタン名 | https://リンク先\n\n例：\n案内はこちら\n掲示板を見る | https://t.me/example\n使い方を見る | https://example.com/help\n\n【② ボタンの見た目を決める】\n入力後のプレビューで「1列」「2列」「3列」を選択します。表示する文字と移動先URLを確認してください。「📝 内容を修正」で書き直せます。\n\n【③ 投稿する】\n投稿先のトピックを選び、公開操作を行います。「キャンセル」は公開前に中止するときに使います。\n\n【注意】\nHTTPSのリンクを使用します。HTTP、短縮URL、ローカル宛先は受け付けません。",
 search:"🔍 検索/フィルター｜投稿や相手を探す\n\n【何をする機能？】\n参加している掲示板の公開済みプロフィールや相手募集を、言葉・条件から探します。新しく投稿する機能ではありません。\n\n【① 探す対象】\n「検索/フィルター」を押し、「プロフ」「相手募集」を選びます。✅が付いている方を検索します。\n\n【② 言葉で探す】\n「🔍 キーワード検索」を押して、探したい言葉を80文字以内で1通送信します。\n\n【③ 条件で絞る】\n「🎛 詳細フィルター」を押します。\nプロフ：エリア／年齢／ポジション／体型／髪型／目的／#Like／#Love。\n相手募集：エリア／ポジション／目的。\n選択肢をタップすると条件に反映され、同じ項目の再タップで解除できます。\n\n【④ 結果を見る】\n「🔎 検索実行」で結果を表示します。1ページ5件。「次へ ▶」「◀ 前へ」でページを切り替え、結果を押すと元の投稿へ移動します。\n\n【⑤ 探し直す】\n「🎛 条件変更」で条件を修正。「条件クリア」で指定した条件を消します。「↩ 戻る」で戻れます。",
 chat:"💬 雑談｜掲示板で会話する\n\n【何をする機能？】\n3つの掲示板にある雑談トピックへ移動します。気軽な会話や交流に使います。募集を投稿するための画面ではありません。\n\n【操作方法】\n① 投稿メニューから「雑談」を押します。\n② 「エリア’s BBS」「ビデオChatの掲示板」「ゲイのための掲示板♂」から移動先を選びます。\n③ 選択したリンクを開いて雑談トピックへ移動し、そこでメッセージを書きます。\n④ 移動をやめるときは「🔙 戻る」で投稿メニューへ戻ります。\n\n【覚えておくこと】\nこのボタンは会話する場所を選ぶためのものです。押しただけではメッセージや募集は投稿されません。",
 invite:"🤝 紹介/招待｜掲示板を人に紹介する\n\n【何をする機能？】\n3つの掲示板の参加先を案内したり、紹介用リンクをコピーして友人に送ったりします。\n\n【操作方法】\n① 投稿メニューから「紹介/招待」を押します。\n② 表示された掲示板から紹介したい先を選びます。\n③ まだ参加承認を受けていない人には「参加質問ゲート」へのリンクを案内します。\n④ 承認済みの人には、各掲示板への参加リンクを案内します。\n⑤ 「リンクをコピー」のボタンがある場合は押してコピーし、紹介したい相手のチャットに貼り付けます。\n⑥ 「🔙 戻る」で投稿メニューに戻ります。\n\n【注意】\n参加資格・規約・ルールの確認が必要な人には、承認質問を飛ばすリンクではなく、質問ゲートの入口を案内してください。"
};
export const TAG_HELP_TEXT="🏷️ #Like と #Love｜違いと選び方\n\n【何を設定するもの？】\n🟢 #Like＝自分自身の特徴・好み・趣味・スタイル。\n🔴 #Love＝相手に求める特徴・好み・趣味・スタイル。\n同じ言葉でも「自分のこと」か「相手への希望」かで意味が変わります。\n\n【どこで使う？】\n「相手募集」「募集+Room」「プロフ作成」の入力画面にある「#Like」「#Love」から設定します。Room応募でも同じタグの選択画面を使います。\n\n【具体的な選び方】\n① 緑の「#Like」または赤の「#Love」を押します。\n② 6分類「エロワード」「パーツ」「プレイ」「雰囲気/外見」「着衣/装備」「性感帯」から分類を選びます。\n③ 候補の言葉をタップします。▫️が✅になれば選択済みです。\n④ 複数選択できます。もう一度タップすると、その項目だけ解除されます。\n⑤ 候補が多いときは「次 ➡️」で次のページ、「↩ 戻る」で前のページまたは分類に戻ります。\n⑥ 「✅ 保存」を押して元の入力画面に戻り、✅ #Like／✅ #Loveを確認します。\n\n【例】\n自分の好きな服装が「スーツ」なら、#Like →「着衣/装備」→「スーツ」を選択。\n相手に「年上好き」のような希望を伝えたいときは、#Love →「雰囲気/外見」から選択。\n実際に自分や相手に当てはまるものだけ選んでください。\n\n【修正するには】\n選択済みの言葉をもう一度押せば解除できます。「キャンセル」は選択操作を中止するときに使います。タグ選択だけで投稿されることはありません。\n\n覚え方：#Like＝自分、#Love＝相手への希望。";
export function helpHomeKeyboard(rev:number){
 const rows=APPROVED_POSTING_ROWS.map(row=>row.map(label=>label==="操作説明"?"戻る":label));
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
 const text=s.section==="tags"?TAG_HELP_TEXT:topic===null?"📚 操作説明\n\n何をしたいか、下のボタンから選んでください。\n\n・相手を探す → 相手募集\n・通話やRoomを募集 → Room+募集\n・自分を紹介 → プロフ\n・日時や予定を知らせる → 告知/予告\n・リンク付き投稿 → 🔗ボタン作成\n・相手や投稿を探す → 検索/フィルター\n・会話する → 雑談\n・参加リンクを紹介 → 紹介/招待\n・動画を販売 → クリエーター有料ビデオ投稿\n\n各説明では「何ができるか」「入力・ボタン操作」「完了後の操作」を案内します。説明を読んだだけでは投稿されません。":sectionText[topic];
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
