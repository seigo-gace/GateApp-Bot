# Gserver後付けを前提としたBot責務・秘匿性（開発段階）

実装方針: サーバー接続前には実Token、個人ID、DBバックアップをRepoへ置かない。現時点でGserverネットワーク構成、Cloudflare Zone、VPN/DNSを変更しない。

- GroupBot は参加認証・グループ運用と投稿権限を所有する。キャンペーン統括や売上元帳はコピーしない。
- TumblrのAI管理からの指示は、信頼済み内部Adapterで署名・権限・operation_idを検証したものだけ受付。自由文を直接Bot API命令に変換しない。
- CMは許可済みリンク台帳のプレビュー／最大3件ローテーション／本文URL禁止／既存InlineKeyboard温存。 `cmRotation.mjs` は選択と整形のみ。永続化は実配信側がownerであり、閲覧プレビューではカーソルを進めず、投稿readback成功時だけ進める。
- 秘密情報: Bot Token、Telegram user session、Sales台帳、Tumblr OAuthは個別のsecretと独立最小権限。外部API/AIへプロフィール・購買者情報を渡さない。
- Gserver配置後の必須試験: 不正トークン拒否、外部入口の認可、秘密ログ除去、URL安全検証、イベント冪等、送信後readback、再起動復元、VPN障害/再接続、バックアップ復旧。
- 本ファイル・純関数は**実Bot/サーバー統合済みを意味しない**。
