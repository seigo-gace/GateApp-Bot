# TGtumbler 文書サイト（Cloudflare Pages）

既存5文書の原文・要約索引と、独立したCreateVdobot利用規約・販売約款を静的 HTML としてビルドし、Cloudflare Pages で配信するための **Git 管理用** ミニサイトです。

## 構成

| パス | 説明 |
|------|------|
| `content/*.md` | Notion から転記した原文（加筆禁止方針。取得欠けは `NOTION_IMPORT_INCOMPLETE` で明示） |
| `summaries.json` | 審査用①〜④・総合案内用①〜⑤の要約（Notion「5文書要約・公開配布設計」由来） |
| `site-config.json` | サイト名・対象ドメイン・Notion URL・要約に含める文書 ID |
| `build.mjs` | `content/` + JSON → `dist/` |
| `dist/` | **ビルド生成物**（`.gitignore` の対象。CI で生成） |

## ローカルビルド

```bash
cd docs/tgtumbler-pages
node build.mjs
# dist/index.html および各全文 HTML
```

## Cloudflare Pages

**デプロイは GitHub Actions + Wrangler**（リポジトリシークレット `CLOUDFLARE_API_TOKEN`）。手順は **[DEPLOY.md](./DEPLOY.md)**。

ダッシュボードの「Connect to Git」だけに統一する場合は **DEPLOY.md の「参考」**に従い、**Wrangler 用ワークフローの deploy ジョブと併用しない**（二重ビルド防止）。

## 公開ゲート（Privacy Policy／CreateVdobotの区分）

**CreateVdobot規約v1.0のみ**、既存のCloudflare Pages `https://tgtumbler-docs.pages.dev/createvdobot-terms.html` で公開中。GitHub Actions `tgtumbler-pages` は本文の自己責任・Stars/管理費30%/計算上70%・同意文言を実HTTP読戻しする。URLの存在はBot本番接続やStars販売が完成した根拠ではない。

それ以外のTGtumbler共通文書にはNotion上で管理主体・問い合わせ先・保持期間等の未確定項目があり、**本番ドメイン紐付け・共通文書を正式な完成版として運用する判断は保留**する。CreateVdobot規約の個別公開を、これらの文書全体の受入に拡大しない。

## 全文データの欠落について

`02-terms.md`（第5条以降）、`04-group-rules.md`（重大違反の具体）、`05-how-to.md`（セクション D 以降）などは、2026-11-07 の取得経路では **本文が途中で切れている** 可能性があります。`NOTION_IMPORT_INCOMPLETE` の箇所を Notion 正本で埋めてから公開してください。
