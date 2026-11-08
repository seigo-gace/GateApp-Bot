/** Dry-run menu render from DB. No Telegram API calls. */
import { pool } from "../src/db/index.js";
import { guideMessageUrl } from "../src/services/guideMessageUrl.js";
import { renderMenuPanel, type NavLink, type EntryLink } from "../src/services/menuPanelRenderer.js";
import { BOARD_GROUP_CHAT_IDS, type BoardKey } from "../src/services/topicRouting.js";

const CHATS = Object.values(BOARD_GROUP_CHAT_IDS);

function boardKey(chatId: number): BoardKey {
  const found = Object.entries(BOARD_GROUP_CHAT_IDS).find(([, id]) => id === chatId)?.[0];
  if (!found) throw new Error("UNREGISTERED_GROUP");
  return found as BoardKey;
}

async function generalGuideLinks(chatId: number): Promise<NavLink[]> {
  const docs = await pool.query(
    `SELECT document_type,message_id FROM general_guide_documents
     WHERE chat_id=$1 AND status='published' AND message_id IS NOT NULL
       AND approved_by IS NOT NULL AND approved_at IS NOT NULL`,
    [chatId],
  );
  const panelLabels: Record<string, string> = {
    terms: "利用規約",
    rules: "グループルール",
    safety: "安全ガイド",
    howto: "使い方",
  };
  const l0DisplayDocs = ["terms", "rules", "safety", "howto"] as const;
  const links: NavLink[] = [];
  for (const [name, label] of Object.entries(panelLabels)) {
    const row = docs.rows.find((r) => r.document_type === name);
    if (!row) continue;
    links.push({ label, url: guideMessageUrl(chatId, Number(row.message_id)), verified: true });
  }
  const missingDocs = l0DisplayDocs.some((name) => !docs.rows.some((r) => r.document_type === name));
  const other = await pool.query(
    `SELECT label,destination_url FROM general_guide_links WHERE chat_id=$1
       AND enabled=TRUE AND verified_by IS NOT NULL AND verified_at IS NOT NULL
       ORDER BY link_key`,
    [chatId],
  );
  links.push(...other.rows.map((r) => ({ label: String(r.label), url: String(r.destination_url), verified: true })));
  if (missingDocs) throw new Error("GUIDE_DOCUMENTS_NOT_APPROVED");
  return links;
}

async function postingLinks(chatId: number): Promise<{ links: NavLink[]; entries: EntryLink[] }> {
  const stored = await pool.query(
    `SELECT label,destination_url FROM board_posting_menu_links
     WHERE chat_id=$1 AND enabled=TRUE AND verified_by IS NOT NULL AND verified_at IS NOT NULL`,
    [chatId],
  );
  const links: NavLink[] = stored.rows.map((row) => ({
    label: String(row.label),
    url: String(row.destination_url),
    verified: true,
  }));
  const gates = await pool.query(
    `SELECT feature FROM gaybbs_feature_release_gates
     WHERE feature IN ('announcement','room','link','search','help')
       AND enabled=TRUE AND length(source_commit)=40
       AND length(trim(ci_evidence))>0
       AND length(trim(gserver_runtime_evidence))>0
       AND length(trim(telegram_e2e_evidence))>0
       AND approved_by IS NOT NULL`,
  );
  const ready = new Set(gates.rows.map((x) => String(x.feature)));
  if (!["announcement", "room", "link", "search", "help"].every((x) => ready.has(x))) {
    throw new Error("POSTING_DM_FEATURES_NOT_RELEASED");
  }
  const entrySpecs = [
    { label: "相手募集", feature: "announcement" as const },
    { label: "募集+Room", feature: "room" as const },
    { label: "告知/予告", feature: "announcement" as const },
    { label: "🔗ボタン作成", feature: "link" as const },
    { label: "検索/フィルター", feature: "search" as const },
    { label: "操作説明", feature: "help" as const },
  ];
  const entries: EntryLink[] = entrySpecs.map((e) => ({
    feature: e.feature,
    label: e.label,
    url: "https://t.me/GayBBS_bot?start=m_dryrun",
    ready: true,
  }));
  return { links, entries };
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = { panels: [] as unknown[] };
  for (const chatId of CHATS) {
    const board = boardKey(chatId);
    for (const panelType of ["general_guide", "posting"] as const) {
      const row = { chat_id: chatId, board, panel_type: panelType };
      try {
        if (panelType === "general_guide") {
          const links = await generalGuideLinks(chatId);
          const rendered = renderMenuPanel({ type: "general_guide", board, links, entryLinks: [] });
          (report.panels as unknown[]).push({
            ...row,
            ok: true,
            text: rendered.text,
            inline_keyboard: rendered.rows,
            button_count: rendered.rows.flat().length,
          });
        } else {
          const { links, entries } = await postingLinks(chatId);
          const rendered = renderMenuPanel({ type: "posting", board, links, entryLinks: entries });
          (report.panels as unknown[]).push({
            ...row,
            ok: true,
            text: rendered.text,
            inline_keyboard: rendered.rows,
            button_count: rendered.rows.flat().length,
          });
        }
      } catch (e) {
        (report.panels as unknown[]).push({
          ...row,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

void main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    void pool.end();
    process.exit(1);
  });
