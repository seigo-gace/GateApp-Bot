# Cloudflare Pages 連携（実運用）

## 採用方式: GitHub Actions + Wrangler（`CLOUDFLARE_API_TOKEN`）

この文書サイトは **`docs/tgtumbler-pages`** をビルドし、**`wrangler pages deploy`** で Cloudflare Pages に載せる。  
**同一リポジトリで Cloudflare ダッシュボードの「Connect to Git」を有効にするとビルドが二重になる**ため、**どちらか一方に統一**する（本構成では **Actions のみ**を正とする）。

### Master が一度だけ行うこと（Cloudflare）

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン（対象アカウント）。
2. 右上プロフィール → **My Profile** → **API Tokens** → **Create Token**。
3. テンプレート **Edit Cloudflare Workers** をベースにするか、カスタムで少なくとも以下を付与:
   - **Account** · **Cloudflare Pages** · **Edit**
   - （カスタムドメインを後から紐付ける場合）**Account** または該当 **Zone** (`hentaigay.org`) の **DNS** 読み取り以上は別途必要になることがある。
4. トークンをコピー（二度と表示されない）。

### Master が一度だけ行うこと（GitHub）

リポジトリ **seigo-gace/GateApp-Bot** → **Settings** → **Secrets and variables** → **Actions**:

| 名前 | 必須 | 内容 |
|------|------|------|
| `CLOUDFLARE_API_TOKEN` | **はい** | 上で作成した API トークン |
| `CLOUDFLARE_ACCOUNT_ID` | 推奨 | Dashboard 右サイドバーの **Account ID**（Wrangler が求める場合がある） |

**Variables**（任意）:

| 名前 | 既定 |
|------|------|
| `CLOUDFLARE_PAGES_PROJECT_NAME` | `tgtumbler-docs`（初回 `wrangler pages deploy` でプロジェクトが作成される） |

### 実測フロー

1. `main` / `master` に **`docs/tgtumbler-pages/`** またはワークフローの変更が入った **push**。
2. Actions で **`tgtumbler-pages`** → **deploy** ジョブが **`CLOUDFLARE_API_TOKEN` 設定済みのときだけ**実行。
3. Cloudflare Pages の該当プロジェクトの **Deployments** に反映され、**`*.pages.dev`** の URL が付く。
4. **本番ドメイン `hentaigay.org` は、③ Privacy の公開承認後に** Pages → **Custom domains** で追加（DNS は当該ゾーンが同じアカウント内であること）。

### プレビューのみ（正式公開前）

- `hentaigay.org` を付ける前は **`pages.dev` の URL のみ**で全文・索引の表示を検証する。

---

## 参考: ダッシュボードの「Connect to Git」だけにしたい場合

Wrangler を使わず **Pages の公式 Git 連携のみ**にするなら:

- Workers & Pages → Create → Pages → **Connect to Git** → Repo `GateApp-Bot`  
- Root: `docs/tgtumbler-pages`、Build: `npm run build`、Output: `dist`

その場合は **`.github/workflows/tgtumbler-pages.yml` の `deploy` ジョブを無効化**するかファイルを削除し、**二重デプロイを避ける**。

---

## ローカルでの手動デプロイ（検証用）

```bash
cd docs/tgtumbler-pages
npm ci
export CLOUDFLARE_API_TOKEN='...'   # シェルにのみ
# 任意: export CLOUDFLARE_ACCOUNT_ID='...'
npx wrangler pages deploy dist --project-name tgtumbler-docs
```

環境にトークンが無い場合は上記は実行できない。
