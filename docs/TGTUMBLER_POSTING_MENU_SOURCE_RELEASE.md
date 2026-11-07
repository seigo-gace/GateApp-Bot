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
4. 既存投稿メニューレンダラは、承認済み4 DM入口と5 verified URLを合成、9個揃わない場合は送信しない。プロフィールや総合案内の構成は変更しない。
5. PostgreSQL既存DB内の `board_posting_menu_links` にグループごとの静的5 URLを保存（初期値なし／既定OFF）。外部URL、秘匿Bot開始URL、未確認Topicは捏造しない。既存公開ゲート・管理者確認が必要。

## 3. 本番一括切替時に必要な実値・確認（Source時点では入力禁止）

対象3グループそれぞれ：

- 公開先の既存Topic `chat_id`, `message_thread_id`, `message_id`, Bot権限、既存ピン位置。Telegramの `t.me/c/.../<message>` の末尾をthread IDとして流用しない。
- 管理者が実際に確認した5リンクを **グループごと** に登録：
  `クリエーター有料ビデオ投稿`／`検索/フィルター`／`雑談`／`紹介/招待`／`操作説明`。既存のアプリ・Topic・承認ゲートを使い、適切な宛先が未確認ならそのグループの公開は拒否。
- `board_posting_menu_links` の各行は `label,destination_url,source,verified_by,verified_at,enabled` を現物に基づき登録。TokenやSecretをコード・GitHub・Notionへ書かない。
- 共通feature gate `gaybbs_feature_release_gates` の `announcement`, `room`, `link` はSource/CI/Gserver Runtime/実Telegram E2E証拠が全て存在し、Masterの承認を得た場合のみ有効化。**Source側から勝手にONにしない。**
- `GAYBBS_PUBLIC_MENU_RELEASE` は実機受入/変更計画に沿ってのみ `enabled`。本記録は有効化命令ではない。
- 既存パネルを `bindpanel posting` で検証→DB/リンク/公開ゲートreadback→ `publishpanel` で既存メッセージ編集優先／初回だけ送信・ピン。保留中・結果不明なら再送しない。Gserver側の既存Runtime接続/配備規則に従う。

## 4. 本番E2E受入

グループ3件×各投稿メニュー9ボタン（行順/表記を含む）、DM起点戻りと検証済みTopic ID一致、初回start/既参加、投稿先制限、本文とリンク入力、悪性/誤URL、1/2/3列、入力失敗、プレビュー修正・戻る・キャンセル、古いボタン/二重タップ、本人限定、未確認宛先、公開同意、公開後message IDs、通信断後の `needs_reconcile` と復旧、Bot再起動後の保存内容を確認する。Android/iOS/Windowsは個別確認。完了した項目だけ証拠として記録。

## 5. 絶対に混同しない状態

- Repo/CI: Source完成やCI PASSを記録できる。
- Gserver: 実際に検証できた配備だけ記録。
- Telegram: 実投稿、操作、受信、許可、メッセージIDの実測だけE2E PASS。
- 未確認のURL・Topic・GateはSourceで適当に埋めず本番時の接続対象として残す。
