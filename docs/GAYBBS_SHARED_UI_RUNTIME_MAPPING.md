# TGtumbler / GayBBS 現行メニュー・共通機能マッピング（変更なし保護）

対象：既存3掲示板と `@GayBBS_bot`。2026-11-15。実装の配置と責務を説明する**索引**であり、表示・動作・正本を再定義する文書ではない。採用済UIの正本は `docs/TGTUMBLER_COMMON_UI_CONTRACT.md`（`chat/tgtumbler-profile-a05-20261104`）。この文書とコードが衝突すれば正本とMaster最新指示を優先する。

## 2026-11-20 現行Source再監査・正本照合（前記索引の更新）
- **対応表の詳細・実コード照合は [TGTUMBLER_COMMON_IMPLEMENTATION_AUDIT_20261119.md](TGTUMBLER_COMMON_IMPLEMENTATION_AUDIT_20261119.md)** に集約。古い「残る検証」は2026-11-15時点の履歴であり、現行実装判定の代用にしない。
- 11ボタンと3掲示板の外装・色・順序・ラベルを維持。DMは `APPROVED_POSTING_ROWS`、`POSTING_DM_CALLBACKS` を使用する。Sourceの公開ゲート6件は本番SQLと結果分類の照合時点ですべて READY（Gserver req_20261120011300000000d501・d502）。表示から押下・送信までのE2Eの完成証拠ではない。
- `dmWizardScreen.ts` と `dmPostingMenuRestore.ts` でTelegramの編集結果が不明なときに重複画面を作らず、確定的な編集拒否時のみ代替。採用元画面のメッセージIDを受け渡す。
- `postingMenuUtilityHandlers.ts` は3雑談トピックの現行IDを `talkDestinationContract.ts` から取得し、既存共通Gateと参加状態を照会。Gate選択は `gate_sessions.requested_talk_index` に永続化。直接加入リンクは承認・加入判定を要する。
- `bugReportHandlers.ts` は無効入力でも元メッセージを削除試行し同じ説明画面へ案内。受付確認と単独の投稿メニューは別送。運営/Userbotの通知配送は別台帳。
- Room応募者一覧も `postingHandlers.ts` で共通Wizard更新に接続し、応募者ボタン・ページング・HTML本文はそのまま維持。
- iOS/iPadOS/Android/Windows/macOSの実機受入は未検証。Bot APIのリクエスト形式が正しいことと、クライアントがボタン表示・押下に対応していることは別。copy_text旧クライアントの自動OS判定によるフォールバックは不可能。
- PR #58はOpen・44ファイル変更を含む。移行・統合にあたって既存Userbotスクリプト等への副作用を照合せず自動mergeしない。

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
| 共通11ボタン接続定義（純粋設定） | `artifacts/bot/src/services/postingMenuContract.ts` | ラベル→機能→callback/URLを一本化。描画/DBに依存しない |
| 共通機能公開判定 | `artifacts/bot/src/services/postingMenuRoutes.ts` | DM/公開メニューで同一のrelease-gate SQL。契約を再エクスポート |
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

1. 修正済み（Source段階）：DMと公開メニューで重複していた「Feature label ↔ destination」を `postingMenuContract.ts`、release gateを `postingMenuRoutes.ts` に分離。**UI描画と公開状態管理は移動しない**。これで画面の行・色・本文・投稿処理は不変。
2. 修正済み（Source段階）：共通GATE URL取得失敗がDMメニュー全体を隠す問題を隔離。GATEが未検証のときは「紹介/招待」だけ既存の `dm:nav-unavailable` callbackにし、他10ボタンの描画・戻るを維持。架空リンクは作らない。GATEが正常なら既存 `copy_text` を維持。
3. 修正済み（Source段階）：グループごとに使われていなかった旧 `board_posting_menu_links` の3行必須チェックを除去。共通のCreator/Talk/GATE接続を採用し、UIやリンク先を変更しない。公開済みメッセージと台帳の編集権限は従来通り。
4. 残る検証：ゲイ掲示板の公開パネルだけTelegram edit結果が未確認。既存公開メッセージ/台帳の照合なしに `message_id` を破棄しない。
5. 残る検証：プロフィール/Room/承認/エリア等を含む全回帰テスト、Botの報告DB→通知のE2E、各端末表示。本番稼働結果とSource/CIを混同しない。
6. 他CUの進行中Sourceを勝手に統合・マージ・再配備しない。保護すべき外装差分があるときは必ず実版を比較する。

## 再実行するべき検証
- 11ボタンの配置 `[3,2,2,3,1]`、文言、色、URL/callback不変。
- 各groupの公開メニューは同一Renderer/Routesを使用し、対象chat/thread/messageのみ変更。
- DM `/start`・固定リンク・キャンセル復帰・古いボタン・未検証URL・期限切れtokenの処理。
- プロフィール、相手募集、Room、告知、検索、リンク、雑談、GATE、不具合報告の回帰。
- Test/CI PASSと、実Telegram/DB/Userbotの本番PASSを区別。


## 2026-11-20｜🔗ボタン作成 最新採用UIと共通責務（Master決定）

設計決定本文の正本は既存Notion「TGtumbler｜Bot DM画面・操作UIの設計変更履歴」2026-11-20節。旧リンクUI案は履歴であり、このセクションを優先する。**Source変更・CI・本番反映の有無は別管理する。**

1. **①素材受信**：投稿形式5択は表示しない。Bot DMの通常入力欄からテキスト・画像・動画・ステッカー等を受け、キャプションも回収。Botが自動判別し既存の本人下書きへ保存。画面下部［キャンセル］→投稿メニュー。
2. **②最初のURLボタン**：1行目にボタン名、2行目にHTTPSのリンク先を1通で受信。色は「標準・青・緑・赤」の必須単一選択。標準がデフォルト✅、別色を押したら✅移動。［戻る］→①やり直し、［キャンセル］→投稿メニュー。
3. **③実物プレビュー**：投稿コードで実際に共有するときと同じ媒体・テキスト・キャプション・URLボタン列/色を表示。メッセージ**本文内**にタップ可能な［ボタンの追加］・［内容の編集］。**下部InlineKeyboardは［登録］［キャンセル］のみ**。旧案の［編集］をInlineKeyboardへ戻さない。Telegram Bot APIのRichTextButton / RichMessageButtonで構成、互換性は実機検証する。非対応時に無許可のUI代替・完成報告禁止。
4. **④ボタン追加**：既存ボタン各々の［削除］、行末［▶］、末尾［▼］を本文内で選択。▶＝当該行の右横、▼＝下段新規行。追加先選択後、②と同じ2行一括入力・色選択・戻る／キャンセル。既存の行構造と他ボタンを保つ。
5. **⑤内容編集**：本文中に［編集］テキスト／画像／動画／ボタン名１〜N。［戻る］［変更］［キャンセル］、選択対象だけを既存有料ビデオ投稿式の入力・部分変更へ渡す。未編集データを保持、戻る→③。
6. **共通実装**：既存 `postingHandlers.ts` と `publicPostRepository.ts` のowner/revision/draft、`dmWizardScreen.ts` のmessage edit+入力メッセージ削除、`inlineSelection.ts` の✅状態、`linkButtonDomain.ts` のURL検証・rowStart配置、`linkInlineShare.ts` の共有コード、`linkRichPreview.ts` のRich本文操作・描画、`telegramDispatcher.ts` の実配送を再利用。DMと公開Menuの `postingMenuContract.ts` / `postingMenuRoutes.ts` を変更・複製しない。
7. **実機受入**：3グループ共通リンク入口→DM①→素材自動回収→②→③→④/⑤→登録・コード共有のE2Eを検証。旧DM `dm:blocked:link` 互換も確認。iOS/AndroidのRich操作を検証。Source/CI/DB記録だけで完成にしない。

**従前契約との関係**：旧共通UI契約には「本文内の見せかけボタンを描かない」条件がある。今回はMasterがリンク作成の①〜⑤に限り本文内の**実際にタップ可能なRichボタン**を承認した限定例外であり、テキストだけの非機能ダミーを許可したものではない。他機能のInlineKeyboard原則は維持。
