# TGtumbler｜投稿メニューと🔗ボタン作成：Source→本番一括切替引継ぎ

Owner: existing TGtumbler / @GayBBS_bot / GateApp-Bot. This is a release checklist, **not** a new project, Bot, server, MPB engine, database or permission grant.

## 1. Master固定条件

- 正本: `docs/TGTUMBLER_COMMON_UI_CONTRACT.md` と Notion既存議事録。
- 投稿メニューは3/1/2/3の9ボタン（順序は `APPROVED_POSTING_ROWS`）。総合案内と別責務。未確定の独自画面・URL・Botを作らない。
- 投稿先は実機検証済み group/chat/thread ID・Bot権限・本人の明示公開に限定。公開済みデータと既存message IDを保護。
- 🔗ボタン作成は `gaybbsBot.ts` → `startLinkEditor` / `postingHandlers.ts` → `linkButtonDomain.ts` → `publicPostRepository.ts` → `publishService.ts` → 既存MPB配信。
- Telegram実機確認前のSource/CI成功を本番完成とは判定しない。

## 2. 既存コードで完成させた接続

1. `/link` または検証済み `m_` のDM入口で同一Botの対話式編集を開く。既存下書きを保持し、URL/表示名/本文を受領、無効入力なら再入力、1–3列のプレビュー→修正/戻る/取消→検証済みTopic選択→本人の最終公開確認。
2. URLはHTTPS必須、既知短縮URL、認証情報付き、ローカル・内部宛先、IPリテラル、禁止ポートを拒否。これは遠隔ページの安全性/リダイレクトの完全判定ではない。
3. 投稿処理は既存 `posting_deliveries` と `link_button_posts`、冪等 `request_key`、不明結果 `needs_reconcile` を使用。グループへの通常URL直接投稿を新しく許可しない。
4. 既存投稿メニューレンダラは、承認済み6 DM入口と3 verified URLを合成、9個揃わない場合は送信しない。プロフィールや総合案内の構成は変更しない。
5. PostgreSQL既存DB内の `board_posting_menu_links` にグループごとの静的3 URLを保存（初期値なし／既定OFF）。外部URL、秘匿Bot開始URL、未確認Topicは捏造しない。既存公開ゲート・管理者確認が必要。

## 検索/フィルターの共通ソース経路（2026-11-08追加）
- 入口: 既存Bot `/search`／投稿メニューの検証済み `m_` Search token／エリアボード等で実際に認証・検証した `https://t.me/GayBBS_bot?start=search`。直接の `start=search` は閲覧専用であり、起点のグループ・Topic IDを推測も復元もしない。
- 既存 `showWizardScreen` と `dmInputOwner`、`inlineSelection` の選択/戻る/同一メッセージ更新、`PROFILE_AREA_CATALOG`・`PROFILE_POSITIONS`・`PURPOSE_TAGS` の確定候補を再利用。新DBは作らず `gaybbs_search_sessions` を既存PostgreSQLへ追加。
- Source: `searchDomain.ts`（選択と検証）、`searchRepository.ts`（公開済みTelegramメッセージのみ）、`searchHandlers.ts`（DM対話）を追加。検索は読取専用であり、個別投稿への応募/削除/マイ投稿管理、非公開プロフィールの表示、未公開募集の表示を作らない。
- 現段階の絞込: 対象（公開プロフィール／公開済み相手募集）、キーワード、地域13ブロック、ポジション、募集目的に加えプロフィール対象の年齢18〜89（1値・範囲）、既存の髪型10/体型13、Notion採用済み#Like/#Loveカテゴリ・12件ページ送りを利用。検索結果は5件ページ送りで既存Telegram公開投稿へのリンクを表示し、新たな検索内容の公開はしない。
- Source検索結果は `profiles.status='published'` かつ `profile_publications.status='published'`、または `announcement_posts.kind='recruitment' AND status='published'` かつ `posting_deliveries.status='sent'` に限定。未確認送信・非公開・削除予定は出さない。**各検索時に `getChatMember` で本人の参加資格を3グループごとに照合し、加入中のグループに限定したSQLだけ実行する。** 未加入・退出・権限エラー・API通信失敗を全て除外し、ユーザーに表示される結果は本人が閲覧できる既存投稿へのリンクのみ。
- 検索は本番feature gate `search` に従う。本番のメニュー入口や静的ボードリンクの有効化には、実機検証と証拠が必要。**Sourceのテストデータや仮URLを本番に流用しない。**

## 操作説明：確定3×2レイアウト（2026-11-08追加）
- 投稿メニューの［操作説明］は、従来の静的未確認リンクではなく、既存 `m_` Token→`help` Feature→Bot DMの `operationHelpHandlers.ts` へ接続。Feature gate `help` の実機検証と公開承認が揃うまで固定メニューを有効化しない。
- 確定画面は **3×2**：［プロフ］［Room+募集］［告知/予告］／［🔗ボタン作成］［検索/フィルター］［戻る］。下位の説明から既存Profile/ROOM/告知/Link/Search機能を開き、機能の独立実装をしない。
- `gaybbs_help_sessions` を既存PostgreSQL内に追加。本人・revision照合、既存共通 `showWizardScreen` を使用した同一DMメッセージ編集、戻る時の既存 `verifiedPostingMenuReturnUrl` のみ採用。未検証グループ/Topicへのリンク推測は禁止。
- 各機能の説明は利用者に手順を段階表示し、既存の実処理へ移る［▶ この機能を開く］を備える。［Room+募集］のみ、異なる業務を誤案内しないよう［🎬 ROOMを作成］と［📢 相手募集を作成］を分け、前者は既存Room編集、後者は既存compact相手募集編集に接続する。\n- 実機では入口TokenとBot本人識別、操作説明の6ボタン位置、下位説明から各ウィザードへの接続、ページ戻り、古いCallback、複数操作後の画面ID維持、Gserver再起動後の保存・通信失敗時の復旧を検証する。

## 3. 本番一括切替時に必要な実値・確認（Source時点では入力禁止）

対象3グループそれぞれ：

- 公開先の既存Topic `chat_id`, `message_thread_id`, `message_id`, Bot権限、既存ピン位置。Telegramの `t.me/c/.../<message>` の末尾をthread IDとして流用しない。
- 管理者が実際に確認した3リンクを **グループごと** に登録：
  `クリエーター有料ビデオ投稿`／`雑談`／`紹介/招待`。既存のアプリ・Topic・承認ゲートを使い、適切な宛先が未確認ならそのグループの公開は拒否。
- `board_posting_menu_links` の各行は `label,destination_url,source,verified_by,verified_at,enabled` を現物に基づき登録。TokenやSecretをコード・GitHub・Notionへ書かない。
- 共通feature gate `gaybbs_feature_release_gates` の `announcement`, `room`, `link`, `search`, `help` はSource/CI/Gserver Runtime/実Telegram E2E証拠が全て存在し、Masterの承認を得た場合のみ有効化。**Source側から勝手にONにしない。**
- `GAYBBS_PUBLIC_MENU_RELEASE` は実機受入/変更計画に沿ってのみ `enabled`。本記録は有効化命令ではない。
- 既存パネルを `bindpanel posting` で検証→DB/リンク/公開ゲートreadback→ `publishpanel` で既存メッセージ編集優先／初回だけ送信・ピン。保留中・結果不明なら再送しない。Gserver側の既存Runtime接続/配備規則に従う。

## 4. 本番E2E受入

グループ3件×各投稿メニュー9ボタンおよび検索入口（行順/表記を含む）、DM起点戻りと検証済みTopic ID一致、初回start/既参加、投稿先制限、本文とリンク入力、悪性/誤URL、1/2/3列、入力失敗、プレビュー修正・戻る・キャンセル、古いボタン/二重タップ、本人限定、未確認宛先、公開同意、公開後message IDs、検索のキーワード/地域/年齢/体型/髪型/ポジション/#Like/#Love/目的/対象切替/5件ページ送り/非公開データ除外/別グループ参加制限、通信断後の `needs_reconcile` と復旧、Bot再起動後の保存内容を確認する。Android/iOS/Windowsは個別確認。完了した項目だけ証拠として記録。

## 5. 絶対に混同しない状態

- Repo/CI: Source完成やCI PASSを記録できる。
- Gserver: 実際に検証できた配備だけ記録。
- Telegram: 実投稿、操作、受信、許可、メッセージIDの実測だけE2E PASS。
- 未確認のURL・Topic・GateはSourceで適当に埋めず本番時の接続対象として残す。
