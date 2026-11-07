# TGtumbler｜投稿・DM・Video・ROOM共通実装横断監査（2026-11-08）

**範囲:** 既存TGtumbler親ProjectのSource、共通UI、既存MPB/GATE/Topic境界、および @CreateVdoBot の動画出品Source。新Bot・新Repo・新Database・本番公開・Secret操作を伴わない差分監査。マスター既決の投稿メニュー3/1/2/3、プロフィール定義、ROOM定員を勝手に作らない仕様、Stars有料動画の販売目的は変更しない。

**正本:** `docs/TGTUMBLER_COMMON_UI_CONTRACT.md`、既存Notion『Bot DM画面・操作UIの設計変更履歴』、GateApp-Bot Current [#7](https://github.com/seigo-gace/GateApp-Bot/issues/7)、CreateVdoBot [BOT_MENU.md](https://github.com/seigo-gace/create-videobot/blob/feat/assistant-ai-and-sales-core/docs/BOT_MENU.md)、共通MPB既存Owner。

## 監査対象・所有権・現在のSource

| 機能領域 | 既存実装／責務 | 今回の差分・確認 | リリースの残条件 |
| --- | --- | --- | --- |
| DM共通画面 | GB `dmWizardScreen.ts`、VB `creatorScreenTransport.mjs`（同一契約） | 送信重複防止：GroupBotも編集結果不明で新メッセージを生成しない。確定したedit拒否時だけfallback、入力削除失敗時は手動案内。両Repoテスト。 | 実Telegram API・端末画面更新E2E |
| 本人別入力所有 | GB `dmInputOwner.ts`＋Profile/Room/Recruitment/Link/Search handler | 入力中step限定。プレビュー中の他の下書きがDMテキストを奪わず、検索／ROOM hostと競合時も所有状態が判定できる。isolated PostgreSQLテスト。 | 実端末のBot同時利用検証 |
| プロフィール共通原本 | GB `profileRepository.ts`, `profileHandlers.ts`, `inlineSelection.ts` | Profile sourceと保存/公開の分離を再確認。旧画面/媒体は別マッピングを維持。 | GATE、実公開同意とProfile E2E |
| 相手募集・応募 | GB `recruitmentHandlers.ts`, `publicPostRepository.ts`, `announcementApplications.ts` | DM入力／選択／プロフィール連動／MPB公開確認経路を再確認。共通画面・DM所有修正の影響範囲。 | 応募／承認／募集終了と実通知E2E |
| ROOM/Jitsi/即時・予告 | GB `postingHandlers.ts`, `roomLifecycle.ts`, `roomJoinLinks.ts`, `roomAccess.ts` | `/room` 再起動で未公開の編集中下書きを初期化しないよう修正。予定日時／外部URL入力のstepも復元。ROOM公開は既存 `announcement_posts`→既存MPB一回。承認制のROOM参加URLはDMで権限判定。 | 実Jitsi接続、権限・日時・開催開始/終了、MPB本番E2E |
| 告知・予告 | GB `postingHandlers.ts` のannouncement wizard, `postingDomain.ts` | `/announce` の日時入力段階を再開して値保持。共通同一画面/入力所有と既存公開経路を利用。 | 保存・予約・期限・実投稿のE2E |
| 🔗ボタン作成 | GB `linkButtonDomain.ts`, `postingHandlers.ts` | 既存DM入力・プレビュー・列数・キャンセル・再開と共通MPBを利用。取消後の古い公開callbackをrevisionで失効。 | 実URL/Topic/InlineKeyboardの動作 |
| 検索/フィルター | GB `searchHandlers.ts`, `searchRepository.ts`, `searchAccess.ts` | 既存候補・DM画面・公開データ限定＋各グループの実参加資格照合。 | 実Telegram権限／グループ別検索E2E |
| 投稿メニュー 9ボタン | GB `menuPanelPublisher.ts`, `menuPanelRenderer.ts`, `menuOriginRepository.ts`, `topicRouting.ts` | 3/1/2/3固定。旧Token失効、生成Tokenの一括DB登録、Telegram反映のレシート＋旧Token失効を1トランザクションに統一。既存グループID台帳を再利用。 | 3グループの実Topic ID・検証済み外部URL4件/グループ・feature gate／ピン留めE2E |
| MPB投稿・編集・削除 | GB `publishService.ts`, `postingDelivery.ts`, `telegramDispatcher.ts`; 既存旧multipost Sourceを再利用 | 同意/公開ゲート/Topic/owner/冪等の既存経路。共通公開取消を `post:cancel:<module>:<revision>` とし古い確認を拒否。投稿結果不明は `needs_reconcile`。独自MPB追加なし。 | 本番配備と実投稿・反映・部分障害回復 |
| 有料動画作成・編集 | VB `creatorWizard.mjs`, `creatorUi.mjs`, `mediaProcessor.mjs`, `autoPreview.mjs` | 同じDM transport契約を利用。thumbnail/sample/Stars main・新規編集共通、30秒切出しと不足プレビュー自動作成の既存処理を維持。繰返し `/start` は既存セッション画面を再利用。 | FFmpeg実機入出力、Telegram媒体取得/アップロード、private storage受入 |
| Stars販売・売上管理 | VB `paidListingPublisher.mjs`, `pgPostingReceipts.mjs`, `pgStarsLedger.mjs`, `salesPanel.mjs` | 既存GATE/Review/Topic/fee30%と権限境界を再利用。送信結果不明 `needs_reconcile` がホーム等の画面遷移で消えないよう修正し、再投稿を拒否するテスト追加。 | Stars実購入/返金/ロック解除、実収益・払出し、利用規約の実機受入 |

**意図的に未変更:** 通信基盤（Gserver/Cloudflare/VPN/Gateway）、既存Project/Repo階層、Bot資格情報、グループの現在のピンとTopic、利用者の本番データ、Stars本番取引、別UserBot。所有者の許可なしに変更しない。

## 本番一括適用までの条件

1. GroupBot・VideoBotとも、この監査範囲の現行HEADとCIを個別に実測して記録する。Source/CI証跡と実Telegram・Gserver証跡を混同しない。
2. 実3グループのchat/thread/message ID、Bot権限、旧固定メニューとの対応、4つの静的実URL/グループ（VideoBot／雑談／紹介・招待／操作説明）、同意と公開ゲートを実機readback。
3. GroupBotとVideoBotの同一ユーザー・Bot別セッション／媒体・DB責務を保持。VideoBotはGATE Owner bridgeを通して既存Topicを受領し、独自Topic/参加GATEを再構築しない。
4. 新規・編集・出品・Stars購入／返金、募集・応募、即時ROOM／予約ROOM、告知・予告、リンク、検索、投稿取消と古いボタン再操作、通信切断・再実行のE2E。配備済み・本番完了は検証済み項目にのみ付与。
5. Creator Stars引出しについては、台帳上の残高と公式受取/払出し手段の検証を分離し、払出実行未確認を成功としない。UIが表示可能なことと、資金移転可能なことも混同しない。

## 結果の意味
この監査で修正した欠陥はSourceと隔離CIでのみ受入可。全機能の製品完成・3グループの本番公開・Stars実取引・継続監視は未検証。各所有Repositoryの現行SHAとActions runをGitHub Current #7に追記して最終確認する。過去に確定したUIや旧履歴を上書きしない。
