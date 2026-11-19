# TGtumbler / GayBBS 共通実装・OS互換性監査（2026-11-19）

## 目的・保護条件
- 既存の全ての確定レイアウト、ボタン名、色、行、文字列と、3グループ、公開済み投稿、Room、保存済みデータを不変とする。
- 現行の参照元は GitHub Issue #7、`docs/TGTUMBLER_COMMON_UI_CONTRACT.md`、PR #58 と Runtime。Source / CI / Host / Telegram端末の状態を混同しない。
- iOS / iPadOS / Android / Windows / macOSを共通の受入対象とする。Bot API updateにはクライアントOS/版がないため、サーバーで推定OS分岐を作らない。
- Telegram公式 `messages.startBot` Deep Linkは既存DMでもStartボタン表示があり得る。グループ公開URL入口とDM内 callback は異なる移送手段。

## 既存実装と接続状態（静的Source確認）
| 責務 | 正本/実装 | 確認 | 残る検証・懸念 |
|---|---|---|---|
| 投稿11ボタン/色 | `menuPanelRenderer.ts`, `postingMenuContract.ts` | 共有定義あり | 3グループ現行公開物と照合未実施 |
| DMボタン生成 | `dmBareStartPostingMenu.ts` | 共通11ボタン利用あり | 端末ごとの実押下は未検証 |
| DM画面更新・旧画面削除 | `dmWizardScreen.ts` | 共通処理あり | 全呼び出し元で利用徹底は未完了。編集拒否の実機復旧も未検証 |
| UIトランスポート/OS互換基準 | `telegramClientCompatibility.ts` | Bot API形式の共通ガードをDMウィザードへ接続 | 各OSの実機PASSは全て未検証 |
| プロフィール | `profileCompactHandlers.ts` 他 | 共通画面利用箇所あり | 旧画面/公開資産/複数端末E2Eは別確認 |
| 相手募集 | `recruitmentHandlers.ts`, `recruitmentRichPreview.ts` | 共通画面利用とRich編集API失敗時の通常InlineKeyboardフォールバックあり | Rich APIが受理されてもiOS等のクライアント表示・編集は別途実機検証。送信/編集/復帰も未検証 |
| Room/募集 | `roomHandlers.ts`, `postingHandlers.ts` | 共通画面利用箇所あり | 状態同期とOS別実機照合は未検証 |
| 告知・予告/リンク作成 | `postingHandlers.ts` | 一部共通処理利用 | 分岐すべての画面/通知/URL検証未完了 |
| 検索・フィルター | `searchHandlers.ts` | 共通画面利用箇所あり | 実iOSでの検索/戻りは未確認 |
| 操作説明 | `operationHelpHandlers.ts` | 共通画面利用箇所あり | OS別確認未完了 |
| 不具合報告 | `bugReportHandlers.ts` | 運営/Userbot独立配送、入力削除・謝罪文・メニュー復帰コードあり | 同一アカウントに管理通知が届く見え方、管理者宛分離と全利用者E2Eは要再確認 |
| 雑談 | `postingMenuUtilityHandlers.ts` | 3トピックの直接URL | `admissionRouting.ts` の共通Gateを経由しておらず未接続 |
| 紹介/招待 | `commonGateInvite.ts`, `postingMenuUtilityHandlers.ts` | 共通GateのコピーUIあり | `copy_text` 未対応クライアントの復帰/実機確認なし |
| 初回DM起動 | `gaybbsBot.ts`, `menuPanelPublisher.ts` | 多数の `?start=` と内部callbackが併存 | `/start` を不要にできると断定不可。公開ボタン入口の整理が必要 |
| 承認/既参加経路 | `gaybbsApproval/admissionRouting.ts`, `onlineGateAccess.ts` | 共通の承認・参加状態検査あり | 雑談・既存Topic入口への全適用は未実装 |
| 公開メニュー送信 | `menuPanelPublisher.ts`→`telegramDispatcher.ts` | URL / copy_text の送信時選択あり | 端末別URL/copy表示は実機未検証 |

## 共通化方針と責務境界
1. **Transport**：公開グループ→DMだけDeep Link。DM内の選択/戻る/取消は callback_query。標準の初回Start表示はクライアント制約として扱う。
2. **OS互換**：Bot APIのcallback 1–64 UTF-8 bytes、copy_text 1–256文字相当のAPI制限、1ボタン1アクションを共通入力検証する。OS推定で条件分岐しない。古いTelegramへの個別救済はURLや通常テキスト等の採用済みUIに沿って設計し、ボタン配置は変えない。
3. **画面管理**：成功後の旧ボタン・旧入力の回収、編集失敗時の代替/削除、callback重複/古さの拒否。DMのUIと完了時に保持する領収メッセージを区別。
4. **Gate**：各機能は既存の共通承認/参加状態判定を再利用。未承認→1回質問Gate、承認済み未参加→既存の参加導線、承認済み参加済み→元の選択トピック。目的トピックIDを推測しない。
5. **業務機能**：プロフィール/募集/Room/リンク/検索/不具合報告の保存・投稿・通知は機能オーナーが管理。共通画面ライブラリが勝手に業務データを消さない。

## 履歴照合によるOS例外の再確認
- Notionの既存UI変更議事録には、相手募集の `sendRichMessage` / 本文横 `📝編集` が非対応だった場合、通常InlineKeyboardへ戻す既決方式が記録されている。現行 `recruitmentHandlers.ts` にも失敗時のフォールバックが存在する。ただし **API成功でも端末表示失敗** はServer側で自動検知できない。
- 端末版差に起因する `copy_text` 非対応・Deep Link再Startは、Bot APIにOS識別子がないため、実機観測と標準の代替導線の採用確認が必要。実機対応済みと表現しない。

## OS別・状態別受入基準（現時点全て NOT_VERIFIED）
| OS | 初回グループ入口 | DM内11ボタン/戻る | Gate/雑談Topic | copy_text | 入力回収/復帰 |
|---|---|---|---|---|---|
| iOS | 未検証 | 未検証 | 未検証 | 未検証 | 未検証 |
| iPadOS | 未検証 | 未検証 | 未検証 | 未検証 | 未検証 |
| Android | 未検証 | 未検証 | 未検証 | 未検証 | 未検証 |
| Windows | 未検証 | 未検証 | 未検証 | 未検証 | 未検証 |
| macOS | 未検証 | 未検証 | 未検証 | 未検証 | 未検証 |

各OSで「未承認／承認済未参加／承認済参加済」「Bot未開始／既開始」「新規入力／保存済下書き／通信障害後の再開」を交差して確認する。CI PASSを実機PASSへ昇格させない。

## 修正の進捗
- 2026-11-19 Source: 共通 `telegramClientCompatibility.ts` でインラインボタンのTransport検証を追加、既存DM共通 `showWizardScreen` に接続、単体テストを追加。
- 残るGap: 雑談へのGate接続、公開メニューからのOS別起動、コピー非対応時の救済、各機能から共通画面へ完全接続、端末別実機受入、Gserver本番再配備。
- この監査は差分が確認された範囲のSource事実のみ。全機能・全OS完成という主張ではない。

## 一次資料
- Telegram公式 Deep links: https://core.telegram.org/api/links
- Telegram公式 Bot API / InlineKeyboardButton: https://core.telegram.org/bots/api
- Source: `artifacts/bot/src/gaybbsBot.ts`, `services/menuPanelPublisher.ts`, `services/menuPanelRenderer.ts`, `services/dmBareStartPostingMenu.ts`, `services/dmWizardScreen.ts`, `services/commonGateInvite.ts`, `bot/postingMenuUtilityHandlers.ts`, `modules/gaybbsApproval/admissionRouting.ts`, `services/onlineGateAccess.ts`, `bot/bugReportHandlers.ts`。
