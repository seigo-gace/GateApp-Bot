# @GayBBS_bot 3機能：Notion保存ソースとの突合監査

**判定：実装未完成。Gserver未配備・Telegram本番E2E未検証。以前の「3機能実装済み」は撤回。**

## 根拠
- Notion現行Profile仕様・実装サンプル：https://app.notion.com/p/40dcdcf128e4812a8c65facfdc5f004c
- Notion02・告知/ROOM/MPB実装コード：https://app.notion.com/p/405cdcf128e4818e9c2aedaf1423af36
- 実Topic台帳：https://app.notion.com/p/40dcdcf128e4815f9640dbe6613521aa
- GitHub Issue #4 Profile / #3 ROOM / #5 Announcement / #7 Current、旧 -AdminSystem/modules/{multipost,room,bbs-recruit}。
- 2026-11-05実取得：現行Profile文書内のTS/SQL fenced source 7件、Notion02内のTS/SQL fenced source 12件。これらは実コードの参照実装だが、Notion自体も本番統合未実施と明記する。

## Source差分（完了と誤認禁止）
| 主責務 | 正本の必須要件 | 現行PR #11状態 |
|---|---|---|
| プロフィール基本 | ニックネーム・身長・体重・年齢・ポジション全必須、2行1通 | **今回修正**：旧nickname任意を拒否・説明とテスト修正 |
| プロフィール②〜⑤ | 容姿/13地域・メディア/PR・#Like 6カテゴリ・希望（任意） | **未実装** |
| 共通プロフィール編集 | 本文内📝/項目単位/ページング/中断復帰 | 基本情報一括のみ。未完成 |
| 公開同期 | 3既存プロフィールTopic、公開項目許諾、編集時message_id維持 | 初期宛先選択と配信のみ。実Topic ID未確定 |
| 本人管理 | 編集/コピー/共有用出力/削除、検索・参照同期 | **未実装** |
| Identity | user_id連動、username変更追随、削除済み確認時の多先cleanupジョブ | **未実装** |
| 告知/募集 | 13目的、場所あり/なし一択+足あり独立、地域・条件 | 種別＋本文のみ。**未実装** |
| 時間 | 公開/イベント/応募締切/掲載終了の4軸、予約/取消/復旧 | 予告の開催日時入力のみ |
| 募集応募 | 受付/重複防止/承認・辞退・保留/定員・締切DB競合/通知 | **未実装** |
| ROOM | Jitsi/持込・予約・準備・開始・延期・中止・終了・参加者導線 | URL生成＋名前＋投稿の初期部分のみ |
| 内部依存 | Profile→MPB、ROOM/運営→Announcement→MPB | **現行ROOM→MPB直結は仕様違反**。要修正 |
| MPB | media/album/buttons、reserve/claim/send/revise/cancel/reconcile、複数宛先receipt | 文字列送信＋delivery初期部分のみ |
| ソース分離 | MPBはProfile/Announcement/ROOMの業務DBを直接編集しない | **今回修正**：配信ackからprofiles直接更新を除去 |
| Topic | 実chat+thread+Bot権限の厳密照合、用途ルーティング | 接続コマンド初期実装のみ、実Telegram未受入 |
| Gserver | 既存PC独立アプリRuntimeに統合、Bot秘密保護と既存Bot隔離 | **未配備**。Gserver PR #16 のPC Chat routeも未実証 |
| E2E | 全端末・DM/投稿/編集/削除/応募/ROOM・停電復旧 | **未実施** |

## 実行済みコード是正
- プロフィール必須nicknameとUI説明・入力テストの不一致を修正。
- previewのevent_at SQL5パラメータ、実投稿へのeventAt伝達、HTMLエスケープ、改行を修正。
- postingDeliveryのacknowledgeDeliveryからProfile業務テーブル直接書込を除去。Profile側受領時のstatus反映は未実装として残す。

## 修復順
1. Notion既存TS/SQL/実装契約と -AdminSystem旧モジュールの利用可能部分を同一PRで現行型・DBに適合移植する。完了条件は3モジュールの確定機能単位。
2. ROOM→Announcement→MPBを修復。公開・編集・削除・予約・媒体・応募・再照合と連動させる。ProfileはMPBへ直結。
3. 現行GserverのPCアプリOwner構成へ安全に配置。Contabo共通HostをPCへ流用せず、未検証のPC CHAT経路を既存稼働と称さない。
4. 3グループBot権限と実Topic message_thread_idを実APIで確認し、本人/閲覧者のTelegram実投稿・端末別E2Eを取る。

**記録は監査完了を示すのみで、製品機能完成ではない。**

## 監査後の実装修正（時系列追記・監査時の不足記録は残す）
- Notion02のTypeScriptから目的タグ13件・場所二者択一+足あり独立の検証関数を `src/services/announcementTags.ts` に実際に移植、`tests/announcementTags.test.ts` を追加。
- 募集DMに13目的選択・場所/移動指定のInlineKeyboardを接続。選択状態を本人のrevision付draftに保存し、公開カード/DB sourceへ伝達。既存の応募・検索やタグ別公開先ルーティングは未完成。
- Notion02の `resolvePublishThread` と `validateForPublish` のコード契約を `announcementRouting.ts` に移植。ただし既存の実Topic台帳を用いた本番呼出は未接続で、実Routing完成とは呼ばない。
- MPBの `PublishRequest` に配信先用途と業務Source型の分離を追加。
- ROOMの初期公開処理をROOM→Announcementレコード→MPBへ修正（旧ROOM→MPB直接依存を廃止）。延期・中止・終了のイベント追随や利用者通知は未完成。
- 各変更にCIと静的検証を実施・照合し、結果は最終HEADのCIと区別する。Gserver本番・Telegram実操作は未実行。
