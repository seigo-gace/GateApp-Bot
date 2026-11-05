> **TGtumbler UI実装の毎回参照入口（2026-11-05 Master確定）:** 本監査を使用して3掲示板のメニュー・プロフィール・ROOM・募集・投稿・検索等を実装/修正/テストする前に、[共通UI・Wizard契約](./TGTUMBLER_COMMON_UI_CONTRACT.md)をFresh取得し、決定済みの画面行配置、ボタン内部処理、同一メッセージ書換え、送信テキスト/添付の削除、取消・再入力・公開資産の保護を照合すること。現在未決定の各ボタンの中身や本番公開を勝手に補完しない。本監査の古い記述と衝突する場合は、Master確定の同契約と各対象Currentの最新決定を優先する。

# @GayBBS_bot 3機能：Notion保存ソースとの突合監査

**判定：実装未完成。Gserver未配備・Telegram本番E2E未検証。以前の「3機能実装済み」は撤回。**

## 根拠
- Notion現行Profile仕様・実装サンプル：https://app.notion.com/p/40dcdcf128e4812a8c65facfdc5f004c
- Notion02・告知/ROOM/MPB実装コード：https://app.notion.com/p/405cdcf128e4818e9c2aedaf1423af36
- 実Topic台帳：https://app.notion.com/p/40dcdcf128e4815f9640dbe6613521aa
- GitHub Issue #4 Profile / #3 ROOM / #5 Announcement / #7 Current、旧 -AdminSystem/modules/{multipost,room,bbs-recruit}。
- 2026-11-05実取得：現行Profile文書内のTS/SQL fenced source 7件、Notion02内のTS/SQL fenced source 12件。これらは実コードの参照実装だが、Notion自体も本番統合未実施と明記する。

## Source差分（完了と誤認禁止）
| 主責務 | 正本の必須要件 | 現行PR #11状態 |
|---|---|---|
| プロフィール基本 | ニックネーム・身長・体重・年齢・ポジション全必須、2行1通 | **今回修正**：旧nickname任意を拒否・説明とテスト修正 |
| プロフィール②〜⑤ | 容姿/13地域・メディア/PR・#Like 6カテゴリ・希望（任意） | **未実装** |
| 共通プロフィール編集 | 本文内📝/項目単位/ページング/中断復帰 | 基本情報一括のみ。未完成 |
| 公開同期 | 3既存プロフィールTopic、公開項目許諾、編集時message_id維持 | 初期宛先選択と配信のみ。実Topic ID未確定 |
| 本人管理 | 編集/コピー/共有用出力/削除、検索・参照同期 | **未実装** |
| Identity | user_id連動、username変更追随、削除済み確認時の多先cleanupジョブ | **未実装** |
| 告知/募集 | 13目的、場所あり/なし一択+足あり独立、地域・条件 | 種別＋本文のみ。**未実装** |
| 時間 | 公開/イベント/応募締切/掲載終了の4軸、予約/取消/復旧 | 予告の開催日時入力のみ |
| 募集応募 | 受付/重複防止/承認・辞退・保留/定員・締切DB競合/通知 | **未実装** |
| ROOM | Jitsi/持込・予約・準備・開始・延期・中止・終了・参加者導線 | URL生成＋名前＋投稿の初期部分のみ |
| 内部依存 | Profile→MPB、ROOM/運営→Announcement→MPB | **現行ROOM→MPB直結は仕様違反**。要修正 |
| MPB | media/album/buttons、reserve/claim/send/revise/cancel/reconcile、複数宛先receipt | 文字列送信＋delivery初期部分のみ |
| ソース分離 | MPBはProfile/Announcement/ROOMの業務DBを直接編集しない | **今回修正**：配信ackからprofiles直接更新を除去 |
| Topic | 実chat+thread+Bot権限の厳密照合、用途ルーティング | 接続コマンド初期実装のみ、実Telegram未受入 |
| Gserver | 既存PC独立アプリRuntimeに統合、Bot秘密保護と既存Bot隔離 | **未配備**。Gserver PR #16 のPC Chat routeも未実証 |
| E2E | 全端末・DM/投稿/編集/削除/応募/ROOM・停電復旧 | **未実施** |

## 実行済みコード是正
- プロフィール必須nicknameとUI説明・入力テストの不一致を修正。
- previewのevent_at SQL5パラメータ、実投稿へのeventAt伝達、HTMLエスケープ、改行を修正。
- postingDeliveryのacknowledgeDeliveryからProfile業務テーブル直接書込を除去。Profile側受領時のstatus反映は未実装として残す。

## 修復順
1. Notion既存TS/SQL/実装契約と -AdminSystem旧モジュールの利用可能部分を同一PRで現行型・DBに適合移植する。完了条件は3モジュールの確定機能単位。
2. ROOM→Announcement→MPBを修復。公開・編集・削除・予約・媒体・応募・再照合と連動させる。ProfileはMPBへ直結。
3. 現行GserverのPCアプリOwner構成へ安全に配置。Contabo共通HostをPCへ流用せず、未検証のPC CHAT経路を既存稼働と称さない。
4. 3グループBot権限と実Topic message_thread_idを実APIで確認し、本人/閲覧者のTelegram実投稿・端末別E2Eを取る。

**記録は監査完了を示すのみで、製品機能完成ではない。**

## 監査後の実装修正（時系列追記・監査時の不足記録は残す）
- Notion02のTypeScriptから目的タグ13件・場所二者択一+足あり独立の検証関数を `src/services/announcementTags.ts` に実際に移植、`tests/announcementTags.test.ts` を追加。
- 募集DMに13目的選択・場所/移動指定のInlineKeyboardを接続。選択状態を本人のrevision付draftに保存し、公開カード/DB sourceへ伝達。既存の応募・検索やタグ別公開先ルーティングは未完成。
- Notion02の `resolvePublishThread` と `validateForPublish` のコード契約を `announcementRouting.ts` に移植。ただし既存の実Topic台帳を用いた本番呼出は未接続で、実Routing完成とは呼ばない。
- MPBの `PublishRequest` に配信先用途と業務Source型の分離を追加。
- ROOMの初期公開処理をROOM→Announcementレコード→MPBへ修正（旧ROOM→MPB直接依存を廃止）。延期・中止・終了のイベント追随や利用者通知は未完成。
- 各変更にCIと静的検証を実施・照合し、結果は最終HEADのCIと区別する。Gserver本番・Telegram実操作は未実行。

## 2026-11-05 追補｜総合案内を含めた原設計再照合（Master差戻し）
- 原設計の現行移管先 [Notion 14相当](https://app.notion.com/p/40dcdcf128e4810fb0a2d64e9788bdd3) を全文取得した。従来の別名「3モジュール完了」は誤り。**同一 @GayBBS_bot の初期公開6つの利用体験**は、①プロフィール、②プロフィール+募集+ROOM、③プロフィール+募集、④総合案内M1、⑤各Topic投稿メニューM2、⑥リンクボタン投稿。6独立システムには分離しない。
- M1：3グループの総合案内への常設InlineKeyboard、既存規約/ルール/Privacy/安全ガイド/使い方・お知らせ・エリアボード・プロフ・検索・ROOM・相互リンク・投稿メニューの導線。正規の各文書の公開先実message_idを維持し、合法性・公開認可未確定の文書やCloudflare Pages仮URLを勝手に公開しない。
- M2：対象の既存Topicごとに原則1枚を固定・更新し、Bot DMへ起点group_id/topic_idを**改ざん不能な短いstart token**で引き継ぐ。一般ユーザーが任意chat/threadを入力できないこと、投稿先を誤らないこと、DMから元の位置へ戻れることが受入条件。
- [現行案内UI](https://app.notion.com/p/40ecdcf128e481918cd1c4957ae1d3a5) はTypeScriptコードフェンス0件で、**運用/版/文書IDの仕様正本**。逆にNotionプロフィールのTS/SQL7件、Notion02のTS/SQL12件はコード参考実装。内容を「すべてNotionに実装コードがある」と一括断定せず、正本種別を分ける。
- 既存GitHub GateApp-Botの `bot/menuHandlers.ts`（47KB）/`bot/keyboards.ts`/`bot/startHandler.ts`/`bot/textHandlers.ts` は**GATE管理者用の実装資産**。そのまま新しい利用者Botへ登録すると管理者権限や参加承認フローが混線するため、既存ロジックは参照し、安全な共通部品だけAdapter化する。
- 旧 `seigo-gace/-AdminSystem/server/modules/multipost/{core,renderer,dispatcher,event-router}.ts`、`room/jitsi-builder.ts`、`bbs-recruit/store.ts` のコード内容をGitHubから直接取得した。送信・編集・削除、button-grid、callback codec、Jitsi設定、募集storeが存在し、新規簡易MPBの重複作成は避ける。旧設計にあるAIタグ/周期投稿/課金等は新採用対象ではない。
- 直前の `generalGuideHandlers.ts` は接続コマンドと単発メニュー返信だけで、**M1固定一投稿更新・M2固定パネル・起点token・リンクボタン投稿の完了ではない**。Docker本番・実Topic ID・文書本文の公開は一切未実行。
- 同一Gserverで稼働する単一新Bot、共有投稿コア、Profile/Announcement/ROOM/案内/リンクの分離されたOwner、Gserver独立アプリ受入が最終完成条件。原設計より機能を勝手に縮小しない。

## 2026-11-05｜開発前の横断整合レビューと実装修正（旧評価は時点情報として保持）

### 今回の設計判定（Notion02 + N14最新原設計 + Masterの投稿/DB最新決定）
1. **投稿履歴とDBは別**。Telegramの既存投稿は活動記録として保持。ROOM LIVE→終了・中止、募集/告知の終了は同じ `chat_id/message_id` を更新。既存ボタンを保存し、受付終了時は無効化。**更新成否不明なら唯一の投稿IDを消さず、再照合**。全公開先が終了表示に変わって通知完了した後だけ、使い捨てのMeeting/Announcement関連DBを削除する。
2. **MPBは配信と宛先別receiptの所有者**。ROOM/告知の業務状態は各Owner。発信時の最終公開本文（HTMLエスケープ済）とInlineKeyboardをMPB送信ACKでmessage_idと一緒に保存してから、同じ本文を編集する。原本 `announcement_posts.text` は公開用カードと同値とは限らないので、履歴編集の元本文として使わない。旧postは本文スナップショット不在時に**照合待ち**、推測で編集しない。
3. **ROOM→Announcement→MPB**。募集が定員到達 `filled` でもROOMは開始/終了する。満員を理由にROOM状態更新をスキップしない。終了の既存募集を勝手に再開しない。
4. **DMテキストの所有者は一つ**。プロフィール①、告知/募集、ROOM作成/開催日時、リンクボタンの各下書きを保持しつつ、最後に操作した機能だけが入力を受け取る。再開時に他の下書きを削除しない。
5. **M1/M2に加えL0/L1/L2階層**。Notion14のエリアL1ブロックは案内のみ（独立投稿エディター設置禁止）、L2地域Topicは起点付き投稿メニュー。現行 `menuPanelHandlers.ts` は `general_guide|posting` だけでL1ブロックの契約と親Topic/戻る導線が未実装。3グループの実Topic台帳・権限未検証につき、現物なしに公開/自動ピンしない。
6. **プロフィール・応募・リンクボタンの全仕様を維持**。プロフィール②〜⑤/本人4操作/メディア・検索/予約/複数宛先部分失敗、ROOM参加権限、Gserver実配備は残る。CI PASSと6機能受入は別。

### 今回の実変更と受入条件
- `posting_deliveries.rendered_text` を追加し、`publishService`→`acknowledgeDelivery` で実送信した本文とmessage_idを同じ更新で記録。ROOM/告知終了表示はこの本文を参照し、未知の旧postは `needs_reconcile` に止める。回帰テストで元投稿HTML本文とMessageIDを維持。
- `roomPostStatus.ts` は投稿先ごとの未確認先行イベントがある場合に次イベントを実行せず、同一投稿のLIVE/終了編集順序を保証。失敗時は自動再送せず照合情報を保持。
- `announcementRoomEvents.ts` は `filled` のROOMイベントを処理。隔離PostgreSQLで満員募集でも既存Telegram投稿へのLIVE更新要求が作られることを検証。
- `dmInputOwner.ts` は既存の `profile_drafts/public_post_drafts/room_host_sessions` の更新日時を比較。Profile/Announcement/ROOMの3テキストハンドラで古い下書きによる入力横取りを拒否。隔離DBで複数同時下書きの所有者を検証。
- **次の開発単位**：N14 L0/L1/L2と現在のM1/M2コード差分、既存プロフィール②〜⑤/本人操作、MPB編集/予約/媒体/複数宛先、Gserver所有契約を一緒に評価し、既存部品の移植と実E2Eを継続。Gserver本番・Telegram実操作は未実施。リリースGateは引き続き閉鎖。

