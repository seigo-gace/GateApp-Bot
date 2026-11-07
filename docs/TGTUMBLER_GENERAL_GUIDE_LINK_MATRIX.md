# TGtumbler｜総合案内13ボタンの3グループ別リンク台帳（2026-11-08）

対象は既存3グループの総合案内。表示は**既存投稿下部の InlineKeyboard、3/3/3/4**。Topicリンク一覧投稿とは別物。本文に「総合案内」「雑談」「コミュニティリンク」を重複掲載しない。

**証拠レベル**: Telegram `t.me/c` URL はNotion「TGtumbler｜地域・Topic現物台帳」A/B/C節のユーザー提供記録。現行Bot APIの `message_thread_id` や、実際に押して到達した結果ではない。未確定は「未取得」、推測禁止。

| 行 | ボタン（正確な表示名） | エリア’s BBS | ビデオChat | ゲイのための掲示板 |
|---|---|---|---|---|
| 1 | お知らせ | 未取得 | https://t.me/c/2373696859/1 | https://t.me/c/3770334893/1 |
| 1 | 雑談 | 未取得 | https://t.me/c/2373696859/4291 | https://t.me/c/3770334893/789 |
| 1 | みんなのプロフ | 未取得 | https://t.me/c/2373696859/1613 | https://t.me/c/3770334893/210 |
| 2 | 全国ボード | 3グループ共通：既存全国ボード投稿IDをDB照合 | 同左 | 同左 |
| 2 | カテゴリーボード | 3グループ共通：既存カテゴリーボード投稿IDをDB照合 | 同左 | 同左 |
| 2 | ビデオ/動画 | 3グループ共通：既存ビデオChat案内投稿IDをDB照合 | 同左 | 同左 |
| 3 | 検索/フィルター | 既存Bot DM統合検索入口を照合 | 同左 | 同左 |
| 3 | 使い方 | general_guide_documents / howto の既存公開投稿IDを照合 | 同左 | 同左 |
| 3 | リンク | https://t.me/c/3847210571/273 | https://t.me/c/2373696859/1724 | https://t.me/c/3770334893/18 |
| 4 | 規約 | general_guide_documents / terms の既存公開投稿IDを照合 | 同左 | 同左 |
| 4 | 規則 | 独立した既存正式投稿を要実測 | 同左 | 同左 |
| 4 | ルール | general_guide_documents / rules の既存公開投稿IDを照合 | 同左 | 同左 |
| 4 | ガイドライン | general_guide_documents / safety の既存公開投稿IDを照合 | 同左 | 同左 |

**総合案内トピックの既存入口**（これらは13ボタンの代替リンクではない）：
- エリア’s BBS: https://t.me/c/3847210571/43
- ビデオChat: https://t.me/c/2373696859/1723
- ゲイのための掲示板: https://t.me/c/3770334893/783

## Source接続

- `artifacts/bot/src/services/generalGuideLinkCandidates.ts`: 調査記録にある9件のユーザー向けリンク（**公開済み/実測済み扱いしない**）。
- `artifacts/bot/src/services/menuPanelPublisher.ts`: 既存公開ボードの投稿message_idから3共通ボードへ接続。利用規約/ルール/ガイドライン/使い方は承認済み`general_guide_documents`の実投稿IDから接続。お知らせ/雑談/プロフ/リンク/検索/規則は個別に確認済みの`general_guide_links`から取得。
- `artifacts/bot/src/services/menuPanelRenderer.ts`: 全13リンクが実際に揃わなければ公開拒否。ラベルや3/3/3/4配置を変更しない。
- `artifacts/bot/src/bot/generalGuideHandlers.ts`: 既存の常設文書投稿IDを管理者が返信で登録する仕組み。`t.me/c`の末尾番号をBot API `message_thread_id`と同一視しない。

## 完了条件

1. エリア’s BBSの「お知らせ」「雑談」「みんなのプロフ」の実リンクを取得し、9件の歴史的URLもTelegram側で再確認。
2. 3グループの4種類の正式常設文書（規約、ルール、ガイドライン、使い方）と**別個の「規則」**の投稿IDを取得。規約・規則・ルールを一つに統合しない。
3. 共通3案内ボードの実投稿ID、およびBot DM検索入口を照合。
4. 管理者検証付きDBに登録し、既存13ボタンInlineKeyboardへ反映。未確認URLは公開しない。既存Bot投稿IDが存在すれば再利用する。
5. Gserver Runtimeで配備し、各グループの13ボタンを実機クリック。Source/CIのみは完成としない。

基準： [Notion Topic台帳](https://app.notion.com/p/40dcdcf128e4815f9640dbe6613521aa)、[Notion既存UI仕様](https://app.notion.com/p/40ecdcf128e481918cd1c4957ae1d3a5)、[GateApp-Bot Issue #7](https://github.com/seigo-gace/GateApp-Bot/issues/7)。以上の他に実リンクを創作しない。
