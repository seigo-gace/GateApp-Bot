# TGtumbler / GayBBS 現行メニュー・共通機能マッピング（変更なし保護）

対象：既存3掲示板と `@GayBBS_bot`。2026-11-15。実装の配置と責務を説明する**索引**であり、表示・動作・正本を再定義する文書ではない。採用済UIの正本は `docs/TGTUMBLER_COMMON_UI_CONTRACT.md`（`chat/tgtumbler-profile-a05-20261104`）。この文書とコードが衝突すれば正本とMaster最新指示を優先する。

## 不変条件
- 投稿メニューの表示は11ボタン `3/2/2/3/1`、文言・順序・色・URL・callbackを維持。既存10ボタンに戻さない。
- エリア’s BBS、ビデオChatの掲示板、ゲイのための掲示板♂は**同じ機能**を使う。差は検証済みchat/thread/message IDとトークンの発行・状態だけ。
- DM内の編集/戻る/キャンセルは原則同一メッセージ更新。ユーザー入力削除と公開メッセージは別責務。
- Userbotの既存Telegramセッションは単一常駐プロセスが所有。報告通知はBot API、Userbotのログインや別MTProtoセッション作成は禁止。
- 既存のプロフィール・Room・募集・有料動画・GATEの仕様・保存済みデータ・公開投稿を変更しない。

## レイヤー別の単一責務

| レイヤー | 正本ファイル | 呼出元 / 目的 |
|---|---|---|
| 表示配列・色・外装 | `artifacts/bot/src/services/menuPanelRenderer.ts` | `APPROVED_POSTING_ROWS`、`postingButtonStyle`、公開本文 |
| 共通11ボタン接続定義・機能リリース判定 | `artifacts/bot/src/services/postingMenuRoutes.ts` | DM/公開メニューのラベル→機能→接続先、release-gate SQLを一本化 |
| DMメニュー生成 | `artifacts/bot/src/services/dmBareStartPostingMenu.ts` | 共通の表示配列と接続定義を利用、DM callback |
| DMメニュー復帰 | `artifacts/bot/src/services/dmPostingMenuRestore.ts` | ウィザードから既存メニューへ戻る |
| DM画面表示/編集・入力削除 | `artifacts/bot/src/services/dmWizardScreen.ts` | edit→送信fallbackとprivate入力削除 |
| グループ別公開メニュー | `artifacts/bot/src/services/menuPanelPublisher.ts` | 共通定義を使用。対象chat/threadで既存メッセージ更新／新規、DB状態管理 |
| 公開メニュー描画/配送 | `artifacts/bot/src/services/menuPanelRenderer.ts`、`telegramDispatcher.ts` | 表示生成とTelegram API呼出を分離 |
| 入口の検証済み紐付け | `artifacts/bot/src/services/menuOrigin.ts`、`menuOriginRepository.ts`、`topicDmEntry.ts` | 既存トークン→投稿元とFeature。URLの末尾をTopic IDと推測しない |
| 3グループのIDとTopic解決 | `artifacts/bot/src/services/topicRouting.ts` | 各boardの識別、検証済みTopicのみ配送 |
| 共通GATE URL | `artifacts/bot/src/services/commonGateInvite.ts` | 既存承認質問を再利用。別々の承認ゲートは作らない |
| Bot DMエントリ/handler配線 | `artifacts/bot/src/gaybbsBot.ts` | `/start` deep link、callback、各handler登録 |
| 投稿メニューの雑談・招待 | `artifacts/bot/src/bot/postingMenuUtilityHandlers.ts` | 既存3雑談Topic選択、承認GATEのcopy |
| 不具合報告 | `artifacts/bot/src/bot/bugReportHandlers.ts` | DM入力・保存・Userbot宛Bot API通知・曖昧送信の重複防止 |
| 相手募集 | `artifacts/bot/src/bot/recruitmentHandlers.ts`、`services/recruitment*.ts` | 募集UI/プレビュー/投稿データ |
| Room + 募集 | `artifacts/bot/src/bot/roomHandlers.ts`、`services/room*.ts` | Room生成・応募・公開状態 |
| プロフ | `artifacts/bot/src/bot/profileCompactHandlers.ts`、`profileHandlers.ts`、`services/profile*.ts` | 私有編集・公開/閲覧 |
| 告知/予告 | `artifacts/bot/src/bot/postingHandlers.ts`、`services/announcement*.ts` | 既存告知/予告 |
| 🔗ボタン | `artifacts/bot/src/bot/postingHandlers.ts` | 既存リンク作成 |
| 検索/フィルター | `artifacts/bot/src/bot/searchHandlers.ts` | 既存検索画面 |
| 操作説明 | `artifacts/bot/src/bot/operationHelpHandlers.ts` | 既存操作説明 |
| クリエーター投稿 | `CreateVdobot` の既存DM `https://t.me/CreateVdobot?start=creator` | 動画Botの所有機能。GayBBSで再実装しない |
| DB Migration | `artifacts/bot/src/db/migrate.ts`、既存SQL migration | 公開メニュー状態／報告状態／個別機能資産 |

## 11ボタンの実行マップ

| 表示 | DM callback | 公開メニューの接続 | 機能Owner |
|---|---|---|---|
| 相手募集 | `dm:recruit` | トークン `r_*` | recruitment / announcement |
| 募集+Room | `dm:room` | `m_*` | room |
| 告知/予告 | `dm:announcement` | `m_*` | announcement |
| プロフ作成 | `dm:profile` | `m_*` | profile |
| クリエーター投稿 | 外部URL | CreateVdobot DM | CreateVdobot |
| 🔗ボタン作成 | `dm:link` | `https://t.me/GayBBS_bot?start=link` | link |
| 検索/フィルター | `dm:search` | `m_*` | search |
| 雑談 | `dm:talk` | `?start=talk` | postingMenuUtility |
| 紹介/招待 | `dm:invite` | 既存GATEの `copy_text` | commonGateInvite |
| 操作説明 | `dm:help` | `m_*` | operationHelp |
| 🐞 不具合を報告 | `dm:bug:open` | `?start=bugreport` | bugReportHandlers |

## 確認で判明した共通化不足と保護方針

1. 修正済み（Source段階）：DMと公開メニューで重複していた「Feature label ↔ release gate ↔ destination」の定義を `postingMenuRoutes.ts` に移動。**UI描画と公開状態管理は移動しない**。これで画面の行・色・本文・投稿処理は不変。
2. 修正済み（Source段階）：共通GATE URL取得失敗がDMメニュー全体を隠す問題を隔離。GATEが未検証のときは「紹介/招待」だけ既存の `dm:nav-unavailable` callbackにし、他10ボタンの描画・戻るを維持。架空リンクは作らない。GATEが正常なら既存 `copy_text` を維持。
3. 残る検証：ゲイ掲示板の公開パネルだけTelegram edit結果が未確認。既存公開メッセージ/台帳の照合なしに `message_id` を破棄しない。
4. 残る検証：プロフィール/Room/承認/エリア等を含む全回帰テスト、Botの報告DB→通知のE2E、各端末表示。本番稼働結果とSource/CIを混同しない。
5. 他CUの進行中Sourceを勝手に統合・マージ・再配備しない。保護すべき外装差分があるときは必ず実版を比較する。

## 再実行するべき検証
- 11ボタンの配置 `[3,2,2,3,1]`、文言、色、URL/callback不変。
- 各groupの公開メニューは同一Renderer/Routesを使用し、対象chat/thread/messageのみ変更。
- DM `/start`・固定リンク・キャンセル復帰・古いボタン・未検証URL・期限切れtokenの処理。
- プロフィール、相手募集、Room、告知、検索、リンク、雑談、GATE、不具合報告の回帰。
- Test/CI PASSと、実Telegram/DB/Userbotの本番PASSを区別。
