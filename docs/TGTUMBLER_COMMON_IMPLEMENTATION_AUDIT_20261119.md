# TGtumbler / GayBBS 共通実装・OS互換性監査（2026-11-19）

## 目的・保護条件
- 既存の全ての確定レイアウト、ボタン名、色、行、文字列と、3グループ、公開済み投稿、Room、保存済みデータを不変とする。
- 現行の参照元は GitHub Issue #7、`docs/TGTUMBLER_COMMON_UI_CONTRACT.md`、PR #58 と Runtime。Source / CI / Host / Telegram端末の状態を混同しない。
- iOS / iPadOS / Android / Windows / macOSを共通の受入対象とする。Bot API updateにはクライアントOS/版がないため、サーバーで推定OS分岐を作らない。
- Telegram公式 `messages.startBot` Deep Linkは既存DMでもStartボタン表示があり得る。グループ公開URL入口とDM内 callback は異なる移送手段。

## 共通処理の呼出マッピング再監査（2026-11-20更新／SourceはPR #58）

> 判定語：実装あり＝該当処理のSource存在、接続あり＝呼出経路あり、実機VERIFIED＝実際のTelegram更新と画面を確認。これらは同義ではない。対象ブランチ `chat/bug-report-userbot-20261115` のSourceだけを根拠にする。旧結論「雑談Gate未接続」は修正履歴であり現行状態ではない。

| 入口／責務 | 既存Owner／呼出元 | Source確認 | 未立証・個別の検証要件 |
|---|---|---|---|
| 投稿11ボタン（3/2/2/3/1） | `menuPanelRenderer.ts` → `dmBareStartPostingMenu.ts` | 実装・共通配列あり。公開4行＋報告1行で旧10ボタンを維持 | 本番3グループの固定パネル現物とURL照合は未確認 |
| 公開メニュー配信 | `menuPanelPublisher.ts` → `telegramDispatcher.ts` | 共通描画・配信が接続済み | Topicごとの固定message_id／権限・端末別開き方は未検証 |
| DM開始／既存Deep Link | `gaybbsBot.ts` → 機能別 startXXX | `?start=` とDM callbackが並存。初回Telegram Startの完全抑止は不可 | 既利用者にStartを再要求しない内部遷移の全経路検査 |
| DMウィザード | `dmWizardScreen.ts` | edit→送信フォールバック→旧画面削除の共通Ownerあり | 全呼出し箇所が正しいメッセージIDを渡すこと／削除失敗・回復／重複操作 |
| DMボタン形式 | `telegramClientCompatibility.ts` → `dmWizardScreen.ts`／`telegramDispatcher.ts` | callback長、行、copy_textの形式チェック接続済み | 正常なBot API出力だけではOS別描画・押下を証明できない |
| プロフ | `gaybbsBot.ts`→`profileCompactHandlers.ts`, `profileHandlers.ts` | 共通画面あり。コンパクト・従来公開処理が併存 | 同一画面／本人／下書きrevision／実投稿受入は分岐ごとに未確認 |
| 相手募集 | `gaybbsBot.ts`→`recruitmentHandlers.ts`, `recruitmentRichPreview.ts` | 共通画面＋Rich失敗時通常InlineKeyboard代替が存在 | iOSでRich成功応答でも描画できるか／取消・投稿・下書き復帰 |
| 募集＋Room・告知 | `gaybbsBot.ts`→`postingHandlers.ts`, `roomHandlers.ts` | 一部は共通画面を利用。多分岐・専用DB/配信あり | すべてのstepでID、入力回収、同一カード更新、LIVE/終了同期 |
| 🔗ボタン作成 | `gaybbsBot.ts`→`postingHandlers.ts` | メニュー押下IDの引継ぎあり | URL構成・プレビュー・編集・キャンセルの全状態テスト |
| 検索/フィルター | `gaybbsBot.ts`→`searchHandlers.ts` | メニュー押下ID引継ぎ＋共通画面利用あり | 対象切替・戻る・端末別入力操作 |
| 操作説明 | `gaybbsBot.ts`→`operationHelpHandlers.ts` | 押されたIDをセッションへ保存。空keyboard発行も防止 | メニューへの復帰・旧セッションの競合・全説明内容と既存仕様の一致 |
| 不具合報告 | `gaybbsBot.ts`→`bugReportHandlers.ts` | 報告・旧画面回収・個別通知・単独メニュー。無効入力時の削除と同画面再表示も追加 | 送信失敗/端末別、同一アカウントで本人・管理通知が重なる場合の区別 |
| 雑談 | `postingMenuUtilityHandlers.ts` → `gaybbsApproval/handlers.ts` → `admissionRouting.ts` | 元の3Topic保持・共通資格照会・未承認のGate接続あり。選択Indexは既存`gate_sessions`へ永続化 | 承認前・承認後・一部加入・再入室の実Telegram確認、元Topic遷移 |
| 紹介・招待 | `postingMenuUtilityHandlers.ts` → `commonGateInvite.ts` | 共通ゲートcopy_textのボタンあり | 旧Telegram iOSのcopy_text非対応時のユーザー向け案内と実機 |
| 入力削除全般 | `removeUserWizardInput`／各機能の削除 | 共通Ownerはあるが機能別経路に直接API呼出も残る | 成功・無効入力・削除失敗の全分岐検査が必要 |
| 権限・Gate | `gaybbsApproval/contract.ts`, `store.ts`, `admissionRouting.ts`, `onlineGateAccess.ts` | 3グループの共有資格／発行記録／加入確認あり。restrictedはis_member=trueだけ加入扱い | 参加申請、承諾、失効、拒否、重複・一部加入の本番実証 |

### コードの経路数（2026-11-20 静的確認）
この数字は完了率ではなく調査の範囲を示す。直接の `sendMessage/reply` が存在しても、その用途が受付・公開・実行エラー等である場合があるため、一律に共通画面へ置換してはならない。

| 主なOwner | Source行数 | showWizardScreen 呼出記述数 | 直接sendMessage/reply 記述数 | bot.action 記述数 |
|---|---:|---:|---:|---:|
| `profileCompactHandlers.ts` | 510 | 1 | 4 | 8 |
| `recruitmentHandlers.ts` | 843 | 1 | 0 | 22 |
| `postingHandlers.ts` | 1749 | 2 | 5 | 26 |
| `searchHandlers.ts` | 264 | 2 | 0 | 10 |
| `operationHelpHandlers.ts` | 130 | 2 | 0 | 2 |
| `postingMenuUtilityHandlers.ts` | 132 | 4 | 2 | 3 |
| `bugReportHandlers.ts` | 259 | 3 | 4 | 2 |

数値は静的スキャン時点の参考値で、ソースが更新された場合は再計測する。特に直接送信の理由、元画面ID、編集後の返却ID、入力エラー削除を手動で照合する。

## Gserver本番公開ゲートとボタン接続の照合（2026-11-20）
- Source `postingMenuContract.ts` はDMの10機能入口を既存コールバックと1件のクリエーターURLに対応。最後の不具合報告は `dm:bug:open`。UIは `APPROVED_POSTING_ROWS` 3/2/2/3/1の11ボタンで維持。
- `dmBareStartPostingMenu.ts` は `gaybbs_feature_release_gates` の状態に応じて `dm:blocked:feature` に置換する経路を持つ。したがって、Sourceコードのアクション登録だけでは本番でのボタン使用可を保証しない。
- Gserverの2026-11-19本番SQL読戻し `req_20261120011300000000d501` はHost EXIT0/PASS。非公開結果を既存Host結果台帳から分類した `req_20261120011800000000d502` は **EXIT100＝READY欠落ビットmask0** として6機能（announcement/help/link/profile/room/search）がREADYと判定された。EXIT100は分類スクリプトの意図的な非ゼロ終了であり、Bot実行失敗ではない。
- この証拠で「公開ゲートがないため6機能すべてのボタンがブロックされている」という推測は否定される。ただし、押下→画面表示→入力→保存・投稿というE2Eとは別。公開メニューの実際のURLと古い固定メッセージは未照合。
- `renderApprovedLinks` では紹介/招待がURLとcopy_text両値を運搬するが、`telegramDispatcher.markup` はcopy_textを優先し**実際のTelegramボタンには1アクションだけ**を書き出す。輸送形式の二重アクションではない。旧クライアントのcopy_text表示は別実機要件。
- コピー先の本文表示、ボタン文言・行・色・数、固定メニューの構成を勝手に変更しない。

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

## 修正の進捗と正確な証拠境界
- 2026-11-19：`telegramClientCompatibility.ts` を共通DM／公開配信へ接続（Source・CI・Hostで検証）。
- 2026-11-19：雑談は3Topicの採用ラベル／順序を維持し共通Gateへ接続。選択Topicは既存gate_sessionsに永続化。画面IDも共通Gateへ引継ぎ（Source・CI・Hostで検証）。
- 2026-11-19：DMメニュー入口からの画面ID引継ぎ、restrictedの加入判定を修正（Source・CI・Hostで検証）。
- 2026-11-20：再監査で不具合報告の無効入力時、削除せず新規返信を重ねる不整合を発見。原文削除を試み元画面を再利用し、失敗なら利用者向け警告を同画面へ表示する変更と単体テストを追加（本更新についてSource／CIとHostは結果を別途照合）。
- 既存業務コード・本番3グループ固定投稿・全端末のE2Eについて、上記の部分検証だけで完了と判断しない。
- 出力の保持：Master確定のボタン名／行／色／位置／各機能と本人下書き・公開済資産を変更しない。
- 未検証：OS別実機、Gate全状態の実操作、iOS古いTelegram版のcopy_text、各画面の入力削除/差替/復旧、動画・Starsなど本要求に関連しない業務owner全体の品質保証。
- 最重要：旧監査の「雑談Gate未接続」「Gserver再配備未実施」は当時の履歴であり現行状態とは異なる。新しい実行結果をSource/CI/Hostの各レイヤーで証明する。

## 一次資料
- Telegram公式 Deep links: https://core.telegram.org/api/links
- Telegram公式 Bot API / InlineKeyboardButton: https://core.telegram.org/bots/api
- Source: `artifacts/bot/src/gaybbsBot.ts`, `services/menuPanelPublisher.ts`, `services/menuPanelRenderer.ts`, `services/dmBareStartPostingMenu.ts`, `services/dmWizardScreen.ts`, `services/commonGateInvite.ts`, `bot/postingMenuUtilityHandlers.ts`, `modules/gaybbsApproval/admissionRouting.ts`, `services/onlineGateAccess.ts`, `bot/bugReportHandlers.ts`。
