/**
 * Static site generator: Markdown (subset) -> HTML for Cloudflare Pages.
 * No network; Node built-in only.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const CONTENT_DIR = join(ROOT, "content");
const DIST = join(ROOT, "dist");
const CONFIG = JSON.parse(readFileSync(join(ROOT, "site-config.json"), "utf8"));
const SUMMARIES = JSON.parse(readFileSync(join(ROOT, "summaries.json"), "utf8"));

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inUl = false;
  let inTable = false;
  const flushUl = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
  };
  const flushTable = () => {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("<!--")) {
      flushUl();
      flushTable();
      out.push(`<!-- ${escapeHtml(line.replace(/^<!--\s*/, "").replace(/\s*-->$/, ""))} -->`);
      continue;
    }
    if (line.trim() === "") {
      flushUl();
      flushTable();
      continue;
    }
    if (line.startsWith("# ")) {
      flushUl();
      flushTable();
      out.push(`<h1>${escapeHtml(line.slice(2).trim())}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      flushUl();
      flushTable();
      out.push(`<h2>${escapeHtml(line.slice(3).trim())}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      flushUl();
      flushTable();
      out.push(`<h3>${escapeHtml(line.slice(4).trim())}</h3>`);
      continue;
    }
    if (line.startsWith("> ")) {
      flushUl();
      flushTable();
      out.push(`<blockquote>${escapeHtml(line.slice(2))}</blockquote>`);
      continue;
    }
    if (line.trim() === "---") {
      flushUl();
      flushTable();
      out.push("<hr/>");
      continue;
    }
    if (/^\|.+\|$/.test(line.trim()) && line.includes("|")) {
      flushUl();
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (!inTable) {
        inTable = true;
        out.push("<table><thead><tr>");
        for (const c of cells) out.push(`<th>${escapeHtml(c)}</th>`);
        out.push("</tr></thead><tbody>");
        continue;
      }
      if (cells.every((c) => /^[-:]+$/.test(c))) continue; // separator row
      out.push("<tr>");
      for (const c of cells) out.push(`<td>${escapeHtml(c)}</td>`);
      out.push("</tr>");
      continue;
    } else if (inTable && !line.includes("|")) {
      flushTable();
    }
    if (line.startsWith("- ")) {
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }
    flushUl();
    flushTable();
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushUl();
  flushTable();
  return out.join("\n");
}

function pageShell({ title, body, canonical, notionUrl }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css"/>
  <link rel="canonical" href="${escapeHtml(canonical)}"/>
</head>
<body>
<header>
  <nav><a href="/">索引</a></nav>
  <p class="meta">出典Notion: <a href="${escapeHtml(notionUrl)}" rel="noopener noreferrer">${escapeHtml(notionUrl)}</a></p>
</header>
<main>
${body}
</main>
<footer>
  <p>TGtumbler 文書サイト — 編集は GitHub の <code>docs/tgtumbler-pages/content/</code> を参照。</p>
</footer>
</body>
</html>`;
}

mkdirSync(DIST, { recursive: true });
copyFileSync(join(ROOT, "styles.css"), join(DIST, "styles.css"));

const docs = [];
const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md")).sort();
for (const file of files) {
  const md = readFileSync(join(CONTENT_DIR, file), "utf8");
  const firstLine = md.split("\n")[0] || "";
  const title = firstLine.replace(/^#\s*/, "").trim() || file;
  const num = file.match(/^([0-9]{2})/)?.[1] ?? "";
  const notionUrl = (num && CONFIG.notionSources[num]) || "#";

  const slug = file.replace(/^\d+-/, "").replace(/\.md$/, "");
  const path = `/${slug}.html`;
  const htmlInner = mdToHtml(md);
  const page = pageShell({
    title,
    body: htmlInner,
    canonical: `https://${CONFIG.domainTarget}${path}`,
    notionUrl,
  });
  writeFileSync(join(DIST, `${slug}.html`), page);
  docs.push({ num, title, slug, path, notionUrl });
}

function renderSummaryList(ids) {
  const parts = ["<ul class=\"summary-list\">"];
  for (const id of ids) {
    const s = SUMMARIES.items[id];
    if (!s) continue;
    const doc = docs.find((d) => d.num === id);
    const link = doc ? doc.path : "#";
    parts.push(`<li><strong>${escapeHtml(s.title)}</strong> — ${escapeHtml(s.body)}<br/><a href="${link}">全文</a></li>`);
  }
  parts.push("</ul>");
  return parts.join("\n");
}

const indexBody = `
<h1>${escapeHtml(CONFIG.siteName)}</h1>
<p>対象ドメイン（公開承認後）: <strong>${escapeHtml(CONFIG.domainTarget)}</strong></p>
<section>
  <h2>5文書（全文）</h2>
  <ul>
    ${docs.map((d) => `<li><a href="${d.path}">${escapeHtml(d.title)}</a></li>`).join("\n")}
  </ul>
</section>
<section>
  <h2>審査用要約（①〜④）+ 全文リンク</h2>
  <p>${escapeHtml(SUMMARIES.intro)}</p>
  ${renderSummaryList(CONFIG.admissionSummaryIds)}
</section>
<section>
  <h2>総合案内用要約（①〜⑤）+ 全文リンク</h2>
  ${renderSummaryList(CONFIG.fullGuideSummaryIds)}
</section>
<section>
  <h2>公開ゲート</h2>
  <p><strong>③ Privacy Policy</strong> は Notion 上で管理主体・連絡先・保持期間等が未確定のため、本番の一般公開・hentaigay.org 本番向けは Master 承認と法務確認まで保留。プレビュー運用は GitHub Actions → Cloudflare Pages のプレビューURLに限定すること。</p>
  <p>② 規約・④ グループルール・⑤ 使い方の一部は、自動取得ツールで本文が途中までのため <code>NOTION_IMPORT_INCOMPLETE</code> コメントで明示。Notion から全文を再取得して差し替え後に公開審査。</p>
</section>
`;

writeFileSync(
  join(DIST, "index.html"),
  pageShell({
    title: CONFIG.siteName,
    body: indexBody,
    canonical: `https://${CONFIG.domainTarget}/`,
    notionUrl: CONFIG.notionSources.mapping,
  }),
);

console.log("BUILD_OK", DIST, "pages=", docs.length + 1);
