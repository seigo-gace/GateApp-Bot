# Cursor Composer｜TGtumbler ONLINE 4画像ROOM案内＋既存GATE横断（本番実装委任書）

**所有権・対象**：既存TGtumbler親Project、既存Repo `seigo-gace/GateApp-Bot`、既存Draft PR #20・Issue #7。別Repo/Project/新Bot/Topic/DB製品を作らない。既存親Workspaceと既存実行経路だけ使用。最初にSERVER_AI Rule Plane #16、既存Current、LOAD_SCOPE / WORKSPACE §6とGserverの現実体をFresh取得し、Source/Runtime両方のHEADを一致確認。

## 本番ONLINEトピックと全移動先（台帳で存在を確認、Bot API thread IDは未実測）

|位置|Telegramグループ|chat_id|既存Topic・目的|既存閲覧URL|実API thread ID|
|---|---|---:|---|---|---|
|掲載先|エリア’s BBS|-1003847210571|オンラインビデオChat（4画像カード掲載元）|https://t.me/c/3847210571/1000|未取得・要現物照合|
|Aの戻り|エリア’s BBS|-1003847210571|📌総合案内|https://t.me/c/3847210571/43|未取得・要現物照合|
|Bの行先|エリア’s BBS|-1003847210571|既存ビデオChat/旧見せ合いビデオChat|https://t.me/c/3847210571/116|未取得・要現物照合|
|Cの行先|ビデオChatの掲示板|-1002373696859|👀ビデオチャット|https://t.me/c/2373696859/1605|未取得・要現物照合|
|Dの行先|ゲイのための掲示板♂|-1003770334893|見せ合い👀 相手を探す|https://t.me/c/3770334893/4|未取得・要現物照合、ROOM専用か要確認|

**禁止**：上記 t.me/c URL の末尾 /1000 /43 /116 /1605 /4 を `message_thread_id` として使わない。URLはユーザー向けの台帳の閲覧リンク。実thread は、既存Bot管理者コマンド・Telegramイベント・Gserverの正規Topic ID台帳で取得する。リンク実クリック・既存閲覧/書込権限も確認。

## 4画像と本文・ボタン

|順序|Image|Drive file ID|本文/役割|唯一のInlineボタン|
|---|---|---|---|---|
|A|00_ONLINE案内_1080.jpg|1XGXbjGOEBsYRF4nZ4mOojRHsoD6YLm1W|即時・予告・ROOM募集・投稿案内|↩ 総合案内へ戻る|
|B|01_エリアsBBS_1080.png|1KZgfk8WlkUnFBbuLxQ5-fjezYO7oFCZu|エリア’s BBSのROOM関連Topic|🎬 ROOM掲示板へ|
|C|02_ビデオChat_1080.jpg|1jf-7v4xxeJSOggF-lMQ7AEc7TDkWydrM|ビデオChatグループのROOM関連Topic|🎬 ROOM掲示板へ|
|D|03_ゲイ掲示板_1080.jpg|1hdR5hr_u7A_AK6kS2f_QVj_1YisGrxj9|ゲイ掲示板の見せ合い・関連Topic|🎬 ROOM掲示板へ|

画像は既存Google Drive `PROJECT/TGserver/ONLINE_ROOM_images/1080x1080` に保存。4画像はDriveの実体を取得しSHA-256実測済。ハッシュ・サイズは `onlineDriveAssetLoader.ts` が正本。画像を再生成・編集・並び替えしない。1投稿につき1写真＋caption＋対応URL InlineKeyboard一個、4件は完全独立、MediaGroupでまとめない。既存Drive画像検証ZIP：会話添付 `TGtumbler_ONLINE_4_original_images_verified.zip`（manifest.json同梱）。これを既存の許可済み媒体転送経路でGserverのread-only画像マウントに供給し、`ONLINE_ROOM_ASSET_DIR` を参照。作業コンテナでのファイル生成・GitHub正本はGserver本番に自動転送されない。

## 横断GATE：実装済みと残り

Source実装：
- `onlineRoomBoard.ts`: 4画像・caption・正式ボタン名、既存URL、GATE STARTリンクの全3件完全性検査。
- `onlineRoomPublisher.ts`, `onlineRoomRuntimeAdapter.ts`, `onlineRoomRelease.ts`: 4件一括ソース、実画像確認、Telegraf sendPhoto、永続DB送信レシート、部分失敗でneeds_reconcile停止。自動公開は無効。
- `onlineDriveAssetLoader.ts`: Driveから実取得した4画像のサイズ/sha256チェックと安全なread-only読込。
- `onlineGateRoutes.ts`: 3グループの実chat ID・目的Topic URL・ランダムなSTARTトークン発行、ハッシュ索引、目的トピック保存、全3件ルート取得。最初はenabled=falseで、実測なしにONにしない。
- `onlineGateAccess.ts` と既存 `startHandler.ts` / `index.ts`: 既存GATE BotでONLINE STARTを受理。ブラックリストとusername確認、getChatMember実測。参加中→直ちに目的Topic URLボタン。承認済み・非参加→質問繰返しなし、既存承認済み招待導線→参加後チェック。未承認・非参加→既存GATEのCAPTCHA・質問・規則同意へ。参加状態不明・ブロックは拒否。
- `gateHandlers.ts`: ONLINEから始めた利用者が既存GATEを完了した後、参加リンクと併せて「✅ 参加後にROOM掲示板へ」ボタンを出す。参加後クリックで再度 membership を確認し、元の目的Topicを示す。
- `db/migrate.ts`: 既存DBに `online_gate_routes`, `online_gate_sessions`, `online_room_board_sets`, `online_room_board_cards` を追加（新製品DB不要）。

**Telegramの制約**：URLをタップしてBotを開く／Startする操作と、承認後のTopicへ移動する操作はユーザーに必要。Botは強制自動ジャンプできない。「承認済みなら、GATE質問を通さず目的Topicボタンを即返す」が実現可能な最大の直接導線。所属確認に失敗したユーザーへ直接Topic URLを渡さない。

## Composer実装順（新規作り直し禁止）

1. 既存RuntimeのGATE Bot実username/ID、`targets` の3 chat_idに対応するtarget_idをread-only確認。別Botへ送るリンクを混同しない。既存GitHub SourceとHostのDBバージョンをFresh確認。
2. 実ONLINE topic (`/1000`)、3 ROOM topics (`/116`, `/1605`, `/4`)、総合案内(`/43`) の実API thread ID、グループの参加権限、DのROOM運用可否を確認する。台帳上の閲覧URLだけで実配備GOにしない。
3. 既存Drive 1080画像4枚を許可済みGserver画像読取領域へ一度だけ配置し、readback SHA-256/ファイルサイズ/1080x1080、read-only mountを確認。Drive URLをTelegram file_idへ代入しない。
4. `issueOnlineGateRoute(key,actualGateBotUsername,verifiedAdminId)` を既存Gate Bot Runtimeから3キー（area_bbs/video_chat/gay_board）へ発行。DBの `online_gate_routes` は初期 `enabled=false`。承認済みBot/Topic/参加分岐が実測できた後に既存3件のみ有効化し、`getOnlineGateLinks()` で3/3 verified=trueをreadback。tokenを自前で推測/手書きしない。
5. 参加状態別に既存Gate Botを検証：既存参加者（再質問しない）、承認済み未参加（質問せず既存入室導線）、未承認未参加（質問GATE）、ブラックリスト、username無し、Bot未起動、Botブロック、別グループだけ合格、Telegram getChatMember失敗、二重タップ、期限切れリンク。許可されていない別Topicへ漏れないこと。
6. 既存ONLINE実Topicで管理者の身元・Bot管理権限を確認し、`online_room_board_sets` の1件を verified 状態に記録。既存ONLINE投稿4件の有無を調べ、旧投稿があれば安易に再投稿せず一致照合。公開処理は管理者承認の単発経路からのみ `releaseOnlineRoomBoard(telegram,{chatId:-1003847210571,threadId:<実測>,verifiedBy:<実測>,imageRoot:<read-only path>})` を呼ぶ。ローカルテストで本番へsendPhotoしない。
7. A→B→C→DのsendPhoto各message ID、caption、画像内容、1 URLボタン、ピン/日次入替方針と部分失敗処理を検証。送信成功不明時は無条件再送禁止。失敗・旧投稿の削除不可は照合台帳に残し、ユーザー投稿を削除しない。
8. 本番実装が許可された段階だけ実Telegramへ反映し、3グループ跨ぎの既存参加者/未加入者の実機E2E、Gserver DB readback、Github Issue #7・PR #20へ成果・未完を記録する。

## 既存GATEとの懸念／非互換

既存 `inviteService.ts` は合格者へ一時的な参加招待を発行（`creates_join_request:false`）。最新版の承認質問GATE要求は質問合格による承認と、Telegramの参加申請モードが混在していた記録があるため、**Composerは現行GATEの運用設定/利用権限を照合し、無断で全3グループを参加自由に変更しない**。既存のGATE Botの質問・管理者承認手順を優先する。参加申請機能の差分があれば同じCurrentに証拠を記録し、既存本番挙動を壊さない最小変更とする。

## 完成条件／境界

- 3移動先の識別、4画像正本、4本文・正しい1ボタン、実GATE STARTの3ルート、参加状態による分岐、元トピックへ戻る導線を実機証明。
- Dの専用運用未確認は未確認と報告し、ROOM作成直行と断言しない。
- 今回のChatはSource整備と委任まで。本番送信・本番デプロイ・新Topic作成は行っていない。Composer実機結果なく『本番完成』と報告しない。