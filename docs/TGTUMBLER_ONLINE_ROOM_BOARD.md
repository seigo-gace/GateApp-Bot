# TGtumbler｜エリア’s BBS ONLINEトピック｜4画像投稿・本番一括反映準備
根拠：Notion https://app.notion.com/p/40ecdcf128e481b3899ac632c8a4b811

## 採用：既存ONLINE Topicに4つの独立投稿
対象：エリア’s BBS既存オンラインビデオChat Topic、台帳の閲覧リンク https://t.me/c/3847210571/1000 （Bot API thread IDとは別）。新Topic/新Projectを作らない。
順序A→B→C→D、各投稿は『既存1080画像1枚→短いcaption→単独Inline URLボタン』。メディアグループにしない。

|順|画像（既存Drive・変更禁止）|表示内容|ボタン|歴史的Topic閲覧先|
|---|---|---|---|---|
|A|00_ONLINE案内_1080.jpg / 元1394.jpg|即時／日時指定ROOM、プロフィール連動の開催案内・予告・募集、使い方|↩ 総合案内へ戻る|https://t.me/c/3847210571/43|
|B|01_エリアsBBS_1080.png / 元1375.png|エリア’s BBSのROOM関連掲示板|🎬 ROOM掲示板へ|https://t.me/c/3847210571/116|
|C|02_ビデオChat_1080.jpg / 元1367.jpg|ビデオ👀ChatのROOM関連掲示板|🎬 ROOM掲示板へ|https://t.me/c/2373696859/1605|
|D|03_ゲイ掲示板_1080.jpg / 元1392.jpg|ゲイのための掲示板♂の見せ合い・交流／ROOM募集案内|🎬 ROOM掲示板へ|https://t.me/c/3770334893/4|

最新の正式ボタン名はA『↩ 総合案内へ戻る』、B/C/D『🎬 ROOM掲示板へ』。旧『👉こちらをタップ👈』は使わない。
既存画像は Google Drive 投稿用1080版フォルダ https://drive.google.com/drive/folders/1D7WNW6kpuBu69z_7LHo0oODLY8Y7m227 に保存。sourceのONLINE_MEDIAに4つの正確なDrive file IDを保存している。Drive file IDはTelegramの写真file_idではない。投稿前に画像実体を取得して正しい順番・寸法・対応を確認する。

## 後続決定：外向けボタンはGATE STARTが必須
B/C/Dは生のTopic URLを公衆向けボタンに直接入れない。既存GATE Botの実usernameと安全な文脈tokenを実Runtimeで発行し、Bot STARTへ渡す。本人がSTARTすると既存参加者か、新規・未合格かを判別して、審査済の参加者に質問を再要求せず目的Topicリンクへ。未合格は既存CAPTCHA→質問2つ→規則同意→承認。Topic /4がROOM専用という運用は未確認なので、D文案は見せ合い・交流の案内としROOM投稿可否を本番前に照合する。

## 実装／残ゲート
- Source: artifacts/bot/src/services/onlineRoomBoard.ts。4投稿順序・画像Drive ID・caption・公式ボタンラベル・旧参照Topic URL・Gate START URL入力検証。
- Tests: artifacts/bot/tests/onlineRoomBoard.test.ts。4枚順序、1投稿1画像1ボタン、GATEリンクの欠落・重複・未検証・直接Topic URL拒否。
- 本番前：4画像取得、ONLINE実thread ID、既存投稿採用可否、GATE署名token作成/利用者別審査、既存参加者復帰、ROOM作成投稿導線、4件の送信レシート・途中失敗対応・日次更新の既存ルール整合。
- 実際の4枚のsendPhoto・固定や更新・Telegram端末E2Eは未実施。Master方針により本番配備は後日一括。

## 2026-11-08｜4画像セット送信Source追加（本番自動送信なし）

- `onlineRoomPublisher.ts`：既存画像4枚の内容と1080×1080寸法を検証した後、A→Dを4回の独立Photo投稿として順序実行。各返却message IDを永続化し、途中エラーなら状態を `needs_reconcile` にして再送しない。利用者向け文章やボタンは `onlineRoomBoard.ts` の既存確定版のみ使用。
- `onlineRoomRuntimeAdapter.ts`：既存BotのTelegram送信器とPostgreSQL台帳への接続部品。Sourceを準備するだけでBot起動時に投稿処理を登録・実行することはない。
- `online_room_board_sets` / `online_room_board_cards`：既存DBマイグレーションへ追加した4投稿セットの照合状態・message ID台帳。新しいBotやProjectは作成しない。
- `onlineRoomPublisher.test.ts`：正常4件の順序・結果記録、途中失敗で前2件を残す、既存レシートがあれば再送拒否、未検証Topic/URL拒否を検査する。

**本番一括配備までの必要接続**：Gserver既存のDrive保護認可で4画像のbytesを得るasset loader、既存GATE Botで発行する目的別署名付きSTART URL、管理者による実ONLINE Topic/threadと既存投稿の確認、既存メッセージとの競合検査、4枚の公開とピン管理の権限・実Telegram E2E。これは実Botへの登録・本番送信完了を意味しない。
