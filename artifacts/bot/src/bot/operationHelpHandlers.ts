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
 recruit:"📝 相手募集｜画面の使い方\n\n■ この機能でできること\n「こんな人と会いたい」「一緒に過ごせる人を探したい」という募集を、自分が選んだ掲示板のトピックに掲載できます。募集内容・希望条件を見た人からの応募を受け付ける機能です。Roomを作る場合は「募集+Room」を使ってください。\n\n■ 1. 最初に送る文章\n「相手募集」を押すとDMの編集画面が開きます。プロフィールの登録状況によって入力内容が変わります。\n\n【プロフ未登録の人】\n① 募集タイトル\n② ニックネーム\n③ 身長 体重 年齢\n④ 募集内容（何をしたいか、いつ、どんな相手を探すか）\n\n入力例（4行をまとめて送信）：\n今夜話せる人を募集\nゼロ\n175 80 40\n今夜、近くで会って話せる人を探しています。時間は相談したいです。\n\n【プロフ登録済みの人】\n1行目：タイトル\n2行目以降：募集内容\n基本情報は保存済みのプロフから連動できます。\n\n■ 2. ボタンは何を選ぶもの？\n「ポジション選択」：自分のポジション\n「#Like」（緑）：自分の特徴や好み\n「#Love」（赤）：相手に求める特徴や好み\n「目的」：この募集で何をしたいか\n「場所」：場所の有無や移動できるか\n\n#Likeと#Loveは、分類→候補の順に押して選択します。✅が付けば選択中。同じ項目を再押下すると解除できます。複数選んで「✅ 保存」で確定します。\n「🪪 プロフ登録」は、この募集を作っている途中でプロフィールも登録したい人向けです。\n\n■ 3. 内容を確認して投稿\n入力やボタン選択はプレビューに反映されます。タイトル・ニックネーム・希望条件を確認し「✅ 投稿する」を押します。投稿先を選ぶ画面が出たらトピックを選択します。「キャンセル」は投稿せず編集をやめるときに使います。\n\n■ 4. 投稿した後\nDMの「✏️ 編集」で内容の変更、「🗑 削除」で取り消し、「📍 投稿先を開く」で掲載先へ戻れます。自分の募集だけ編集・削除できます。",
 room:"🎬 募集+Room｜作成から終了まで\n\n■ この機能でできること\n相手募集に通話・Roomの参加先を付けて、参加者を募ります。普通の募集とは違い、参加方式・開始時刻・応募者の管理・終了操作があります。\n\n■ 1. どのRoomを使う？\n「募集+Room」を押すと最初に2つのボタンが出ます。\n「Room作成」：この機能で参加用Roomを用意します。\n「Room持ち込み」：すでに持っているRoomを利用します。持ち込みの場合はHTTPSの参加URLをDMに送信してください。\n「キャンセル」：ここで作成を中止します。\n\n■ 2. 募集の文章を入力\nプロフィール未登録：\n1行目 タイトル\n2行目 ニックネーム\n3行目 身長 体重 年齢\n4行目以降 募集内容\n\n例：\n今夜Roomで話そう\nゼロ\n175 80 40\n今夜20時ごろから参加できる方を募集します。\n\nプロフィール登録済みならタイトルと募集内容を入力し、登録情報を連動します。入力後はDMのプレビューに反映されます。\n\n■ 3. 希望条件のボタン\n「ポジション選択」＝自分のポジション\n「#Like」＝自分の特徴・好み\n「#Love」＝相手への希望\n「目的」＝何をする募集なのか\n「場所」＝場所や移動条件\n#Like・#Loveは緑/赤のボタン→6分類→候補をタップ→「✅ 保存」。複数選択でき、もう一度押せば解除します。\n\n■ 4. いつ、どう参加する？\n「▶ 即開始」：今から始める募集です。押すとそのまま投稿処理に進むため、先に内容を確認してください。\n「📅 予告する」：後で開催する募集です。\n予告を選んだ場合は「自由参加」（誰でも参加）または「承認制」（募集主の許可が必要）を選び、カレンダーから日付→時→分の順で設定します。日時は日本時間です。\n最後にプレビューを確認して「✅ 投稿する」を押します。\n\n■ 5. 投稿後の管理\n「応募者を見る」から誰が応募したかを確認できます。承認制では応募者を承認・拒否します。\n「開始して入室」でRoomを開きます。利用を終えたら終了操作を行います。終了後はLIVE表示や参加導線も終了状態へ切り替わる設計です。\n不要な募集は自分のDMから削除できます。",
 announcement:"📣 告知/予告｜予定を掲示板に知らせる\n\n【何をする機能？】\nメンバーへお知らせを届ける「告知」と、これからの予定・開催時刻を知らせる「予告」を作る機能です。\n\n【① 種類を選ぶ】\n「告知/予告」を押して、「📢 告知」または「📅 予告」を選びます。✅が付いた方が選択中です。\n\n【② 内容を書く】\n「📝 本文編集」を押して案内文を1通送信します。\n例：今夜の交流会のお知らせ。参加希望の方は募集内容をご確認ください。\n\n【③ 日時と投稿先】\n予告では「📅 日時・受付」から開催日時・受付内容を設定します。\n「🔗 プロフ連携」は自分のプロフィールを付ける設定です。\n「📍 投稿先」から掲示板の投稿先トピックを選びます。\n\n【④ 保存・公開】\n本文・日時・投稿先を確認して「✅ 投稿」で公開します。あとで作業を続けたいときは「下書き保存」。「キャンセル」は投稿しません。\n\n【確認ポイント】\n予告は予定日時を間違えないようにしてください。送信しただけではなく、最終の投稿ボタンで公開します。",
 profile:"🪪 プロフ作成｜登録と編集の手順\n\n■ この機能でできること\nあなた自身のプロフィールを作る機能です。募集する相手に、自分がどんな人か、どんなことが好きかを伝えられます。文章だけでなく、写真・動画を合わせて5件まで載せられます。\n\n■ 1. 最初に入力する内容\n「プロフ作成」を押し、DMに次の順で1通送信します。\n\n1行目：タイトル（例：自己紹介）\n2行目：ニックネーム\n3行目：身長 体重 年齢（数字を空白で区切る）\n4行目以降：自己PR（任意・改行自由）\n\n入力例：\n自己紹介\nゼロ\n175 80 40\n休みの日は映画を見ています。気軽に話しかけてください。\n\n■ 2. 各ボタンの意味\n「ポジション」：自分のポジションを選ぶ\n「#Like」（緑）：自分自身の特徴・好み・趣味\n「#Love」（赤）：相手に求める特徴・好み\n「目的」：どんな交流を希望するか\n「場所」：場所や移動に関する条件\n「容姿/エリア」：外見に関する項目・住んでいる地域を設定する\n\n#Like・#Loveは6分類から言葉を選びます。複数選択可能。✅なら選択中、同じ候補をもう一度押せば解除です。選び終えたら「✅ 保存」で戻ります。\n「#Like・#Loveの説明」から操作の詳細も読めます。\n\n■ 3. 写真・動画を載せる\n「🖼️🎬 アルバム」を押し、Telegramの添付から写真または動画を送ります。合計5件まで登録できます。\n「🖼️アルバムを見る」で登録済みの画像・動画を確認します。\n既存の素材を変えるときは「差替 番号」、消すときは「削除 番号」とDMに入力します。番号はアルバム画面に表示されます。\n\n■ 4. 公開する\nプレビューで内容を確かめ「✅ 保存・3掲示板へ投稿」を押します。3グループの「みんなのプロフ」への反映を行い、結果をDMで通知します。保存だけ成功し投稿結果が未確認の場合は成功と表示しません。\n\n■ 5. ほかの操作中に登録したいとき\n相手募集・募集+Room・応募画面の「🪪 プロフ登録」からも進めます。作りかけの募集・応募は保持し、既存プロフィールを無断で上書きしません。",
 paid:"🎬 有料ビデオ投稿｜自分の作品を販売する\n\n【何をする機能？】\n動画をTelegram Starsの価格で販売し、販売した作品や売上を専用Botで管理します。\n\n【① 専用Botを開く】\n投稿メニューの「クリエーター有料ビデオ投稿」を押し、CreateVdobotへ移動します。\n\n【② 動画を登録】\n「🎬 動画を投稿」を選び、タイトル、動画、サムネイル、30秒以内のサンプルなどを登録します。案内に沿って素材を送信してください。\n\n【③ Stars価格を決める】\n用意された価格ボタン、または自由入力で価格を設定します。サンプルと価格を確認して公開します。\n\n【④ 販売後】\n「📦 マイ動画」から作品を確認・編集・削除できます。「💰 売上・出金」から売上残高を確認します。\n\n【注意】\n販売手数料は30%の設計です。専用Bot側の販売画面で、購入者が見る内容と価格を確認してください。",
 link:"🔗 ボタン作成｜リンク付き投稿を作る\n\n【どんな機能？】\nTelegramの投稿に、押すと指定URLへ移動するボタンを付ける機能です。掲示板や案内ページへの誘導に使います。本文とボタンだけでなく、「テキストのみ」「画像＋コメント」「動画＋コメント」の3形式を使い分けるのが新しい採用設計です。\n※画像・動画の登録とコメントの配置はPR #55では未実装です。現在のBotで使えると断定しないでください。\n\n【① 投稿する内容を決める】\nテキストのみ＝文章とリンクボタン。\n画像＋コメント＝写真・説明文・リンクボタン。\n動画＋コメント＝動画・説明文・リンクボタン。\nまずどの形式を使うか考えます。媒体付きの操作画面は対応実装後に利用してください。\n\n【② 最初のボタンを作る】\n「🔗ボタン作成」を押し、ボタン名とURLを次の2行でまとめて1通送信します。\n1行目：ボタンに表示する名前\n2行目：https://で始まるリンク先\n\n入力例：\nグループの案内を見る\nhttps://example.org/guide\n\n1個目は横列を指定しません。リンク先はHTTPS形式で、URL短縮サービスなどは使えません。\n\n【③ 2個目以降を追加する】\nプレビューにある「➕ ボタンを追加」＝次の行に作る。\n「➡️ 横にボタンを作る」＝直前のボタンの右隣に作る。\nどちらかを押して、次のボタン名とURLをまた2行で送信します。押すたびに追加先が決まり、元のボタンは残ります。\n\n【④ 編集・投稿する】\n「📝 最後を編集」＝最後のボタンの名前・URLを直す。\n「📍 投稿先を選択」＝投稿するトピックを選ぶ。\n公開前プレビューのボタン配置とリンク先を確認し、投稿操作へ進みます。「キャンセル」は編集を中止します。\n\n【確認してほしいこと】\n画像＋コメント／動画＋コメントの細かな操作は未実装のため、このガイドは採用設計の案内です。実際に選択できるようになるまで、対応済みとは表示しません。",
 search:"🔍 検索/フィルター｜投稿や相手を探す\n\n【何をする機能？】\n参加している掲示板の公開済みプロフィールや相手募集を、言葉・条件から探します。新しく投稿する機能ではありません。\n\n【① 探す対象】\n「検索/フィルター」を押し、「プロフ」「相手募集」を選びます。✅が付いている方を検索します。\n\n【② 言葉で探す】\n「🔍 キーワード検索」を押して、探したい言葉を80文字以内で1通送信します。\n\n【③ 条件で絞る】\n「🎛 詳細フィルター」を押します。\nプロフ：エリア／年齢／ポジション／体型／髪型／目的／#Like／#Love。\n相手募集：エリア／ポジション／目的。\n選択肢をタップすると条件に反映され、同じ項目の再タップで解除できます。\n\n【④ 結果を見る】\n「🔎 検索実行」で結果を表示します。1ページ5件。「次へ ▶」「◀ 前へ」でページを切り替え、結果を押すと元の投稿へ移動します。\n\n【⑤ 探し直す】\n「🎛 条件変更」で条件を修正。「条件クリア」で指定した条件を消します。「↩ 戻る」で戻れます。",
 chat:"💬 雑談｜掲示板で会話する\n\n【何をする機能？】\n3つの掲示板にある雑談トピックへ移動します。気軽な会話や交流に使います。募集を投稿するための画面ではありません。\n\n【操作方法】\n① 投稿メニューから「雑談」を押します。\n② 「エリア’s BBS」「ビデオChatの掲示板」「ゲイのための掲示板♂」から移動先を選びます。\n③ 選択したリンクを開いて雑談トピックへ移動し、そこでメッセージを書きます。\n④ 移動をやめるときは「🔙 戻る」で投稿メニューへ戻ります。\n\n【覚えておくこと】\nこのボタンは会話する場所を選ぶためのものです。押しただけではメッセージや募集は投稿されません。",
 invite:"🤝 紹介/招待｜掲示板を人に紹介する\n\n【何をする機能？】\n3つの掲示板の参加先を案内したり、紹介用リンクをコピーして友人に送ったりします。\n\n【操作方法】\n① 投稿メニューから「紹介/招待」を押します。\n② 表示された掲示板から紹介したい先を選びます。\n③ まだ参加承認を受けていない人には「参加質問ゲート」へのリンクを案内します。\n④ 承認済みの人には、各掲示板への参加リンクを案内します。\n⑤ 「リンクをコピー」のボタンがある場合は押してコピーし、紹介したい相手のチャットに貼り付けます。\n⑥ 「🔙 戻る」で投稿メニューに戻ります。\n\n【注意】\n参加資格・規約・ルールの確認が必要な人には、承認質問を飛ばすリンクではなく、質問ゲートの入口を案内してください。"
};
export const TAG_HELP_TEXT="🏷️ #Like と #Love｜違いと選び方\n\n【何を設定するもの？】\n🟢 #Like＝自分自身の特徴・好み・趣味・スタイル。\n🔴 #Love＝相手に求める特徴・好み・趣味・スタイル。\n同じ言葉でも「自分のこと」か「相手への希望」かで意味が変わります。\n\n【どこで使う？】\n「相手募集」「募集+Room」「プロフ作成」の入力画面にある「#Like」「#Love」から設定します。Room応募でも同じタグの選択画面を使います。\n\n【具体的な選び方】\n① 緑の「#Like」または赤の「#Love」を押します。\n② 6分類「エロワード」「パーツ」「プレイ」「雰囲気/外見」「着衣/装備」「性感帯」から分類を選びます。\n③ 候補の言葉をタップします。▫️が✅になれば選択済みです。\n④ 複数選択できます。もう一度タップすると、その項目だけ解除されます。\n⑤ 候補が多いときは「次 ➡️」で次のページ、「↩ 戻る」で前のページまたは分類に戻ります。\n⑥ 「✅ 保存」を押して元の入力画面に戻り、✅ #Like／✅ #Loveを確認します。\n\n【例】\n自分の好きな服装が「スーツ」なら、#Like →「着衣/装備」→「スーツ」を選択。\n相手に「年上好き」のような希望を伝えたいときは、#Love →「雰囲気/外見」から選択。\n実際に自分や相手に当てはまるものだけ選んでください。\n\n【修正するには】\n選択済みの言葉をもう一度押せば解除できます。「キャンセル」は選択操作を中止するときに使います。タグ選択だけで投稿されることはありません。\n\n覚え方：#Like＝自分、#Love＝相手への希望。";
/** Each screen is one topic step, not a long scrolling wall of text.
 * Headings are kept whole; Telegram edits the same Bot message on Next/Back.
 */
export function helpTopicPages(topic:Topic):string[]{
 const original=sectionText[topic];
 const first=original.indexOf("\n\n");
 const title=first>=0?original.slice(0,first):original;
 const body=first>=0?original.slice(first+2):"";
 const segments=body.split(/\n\n(?=(?:■ |【))/).filter(Boolean);
 if(!segments.length)return [original];
 const pages=segments.map((segment,index)=>
  title+"\n"+(index+1)+" / "+segments.length+"\n\n"+segment);
 return pages;
}
export function helpTagPages():string[]{
 const first=TAG_HELP_TEXT.indexOf("\n\n");
 const title=TAG_HELP_TEXT.slice(0,first);
 const sections=TAG_HELP_TEXT.slice(first+2).split(/\n\n(?=【)/).filter(Boolean);
 return sections.map((item,index)=>title+"\n"+(index+1)+" / "+sections.length+"\n\n"+item);
}
export function helpTagKeyboard(rev:number,page:number){
 const total=helpTagPages().length;
 const navigation=[
  ...(page>0?[Markup.button.callback("⬅ 前へ",`help:tagpage:${rev}:${page-1}`)]:[]),
  ...(page+1<total?[Markup.button.callback("次 ➔",`help:tagpage:${rev}:${page+1}`)]:[]),
 ];
 return Markup.inlineKeyboard([
  ...(navigation.length?[navigation]:[]),
  [Markup.button.callback("↩ 操作説明へ戻る",`help:home:${rev}`)],
 ]);
}
export function helpHomeKeyboard(rev:number){
 const rows=APPROVED_POSTING_ROWS.map(row=>row.map(label=>label==="操作説明"?"戻る":label));
 return Markup.inlineKeyboard(rows.map(row=>row.map(label=>
  Markup.button.callback(label,label==="戻る"?`help:back:${rev}`:
    `help:topic:${rev}:${SECTION_KEYS.find(key=>sectionLabels[key]===label)}`))));
}
export function helpSectionKeyboard(rev:number,section:Topic,page=0){
 const total=helpTopicPages(section).length;
 const navigation=[
  ...(page>0?[Markup.button.callback("⬅ 前へ",`help:page:${rev}:${section}:${page-1}`)]:[]),
  ...(page+1<total?[Markup.button.callback("次 ➔",`help:page:${rev}:${section}:${page+1}`)]:[]),
 ];
 return Markup.inlineKeyboard([
  ...(navigation.length?[navigation]:[]),
  ...(section==="profile"||section==="room"||section==="recruit"?[[Markup.button.callback("🏷️ #Like・#Loveの説明",`help:tags:${rev}`)]]:[]),
  ...(page===total-1&&["profile","room","announcement","link","search"].includes(section)?[[Markup.button.callback("▶ この機能を開く",`help:open:${rev}:${section}`)]]:[]),
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
async function show(t:Telegram,id:number,s:Session,page=0){
 const topic=s.section==="home"||s.section==="tags"?null:s.section;
 const text=s.section==="tags"?(helpTagPages()[page]??helpTagPages()[0]):topic===null?"📚 操作説明\n\n何をしたいか、下のボタンから選んでください。\n\n・相手を探す → 相手募集\n・通話やRoomを募集 → Room+募集\n・自分を紹介 → プロフ\n・日時や予定を知らせる → 告知/予告\n・リンク付き投稿 → 🔗ボタン作成\n・相手や投稿を探す → 検索/フィルター\n・会話する → 雑談\n・参加リンクを紹介 → 紹介/招待\n・動画を販売 → クリエーター有料ビデオ投稿\n\n各説明では「何ができるか」「入力・ボタン操作」「完了後の操作」を案内します。説明を読んだだけでは投稿されません。":helpTopicPages(topic)[page]??helpTopicPages(topic)[0];
 const keyboard=s.section==="tags"?helpTagKeyboard(s.revision,page):topic===null?helpHomeKeyboard(s.revision):helpSectionKeyboard(s.revision,topic,page);
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
 bot.action(/^help:page:(\d+):(profile|room|announcement|link|search|recruit|chat|invite|paid):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const rev=Number(ctx.match[1]),topic=ctx.match[2] as Topic,page=Number(ctx.match[3]);
  const session=await load(ctx.from.id);
  const total=helpTopicPages(topic).length;
  if(!session||session.revision!==rev||session.section!==topic||
   !Number.isSafeInteger(page)||page<0||page>=total){
   await ctx.answerCbQuery("古い操作です。操作説明から開き直してください。");return;
  }
  await ctx.answerCbQuery();
  await show(ctx.telegram,ctx.from.id,await advance(ctx.from.id,rev,topic),page);
 });
 bot.action(/^help:tags:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const rev=Number(ctx.match[1]),session=await load(ctx.from.id);
  if(!session||session.revision!==rev||!(session.section==="profile"||session.section==="room"||session.section==="recruit")){
   await ctx.answerCbQuery("古い操作です。操作説明から開き直してください。");return;
  }
  await ctx.answerCbQuery();
  await show(ctx.telegram,ctx.from.id,await advance(ctx.from.id,rev,"tags"));
 });
 bot.action(/^help:tagpage:(\d+):(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const rev=Number(ctx.match[1]),page=Number(ctx.match[2]);
  const session=await load(ctx.from.id);
  if(!session||session.revision!==rev||session.section!=="tags"||
   !Number.isSafeInteger(page)||page<0||page>=helpTagPages().length){
   await ctx.answerCbQuery("古い操作です。操作説明から開き直してください。");return;
  }
  await ctx.answerCbQuery();
  await show(ctx.telegram,ctx.from.id,await advance(ctx.from.id,rev,"tags"),page);
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
