/** Dry-run menu render from DB. No Telegram API calls. */
import { pool } from "../src/db/index.js";
import { loadGeneralGuideNavLinks } from "../src/services/generalGuideNavLinks.js";
import { renderMenuPanel, type NavLink, type EntryLink } from "../src/services/menuPanelRenderer.js";
import { BOARD_GROUP_CHAT_IDS, type BoardKey } from "../src/services/topicRouting.js";

const CHATS = Object.values(BOARD_GROUP_CHAT_IDS);

function boardKey(chatId: number): BoardKey {
  const found = Object.entries(BOARD_GROUP_CHAT_IDS).find(([, id]) => id === chatId)?.[0];
  if (!found) throw new Error("UNREGISTERED_GROUP");
  return found as BoardKey;
}

async function generalGuideLinks(chatId: number): Promise<NavLink[]> {
  return loadGeneralGuideNavLinks(chatId);
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
  const entries: EntryLink[] = [
    { feature: "announcement", label: "相手募集", url: "https://t.me/GayBBS_bot?start=r_dry", ready: true },
    { feature: "room", label: "募集+Room", url: "https://t.me/GayBBS_bot?start=m_dry", ready: true },
    { feature: "announcement", label: "告知/予告", url: "https://t.me/GayBBS_bot?start=m_dry2", ready: true },
    { feature: "link", label: "🔗ボタン作成", url: "https://t.me/GayBBS_bot?start=m_dry3", ready: true },
    { feature: "search", label: "検索/フィルター", url: "https://t.me/GayBBS_bot?start=m_dry4", ready: true },
    { feature: "help", label: "操作説明", url: "https://t.me/GayBBS_bot?start=m_dry5", ready: true },
  ];
  return { links, entries };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  for (const chatId of CHATS) {
    const board = boardKey(chatId);
    for (const panelType of ["general_guide", "posting"] as const) {
      try {
        if (panelType === "general_guide") {
          const links = await generalGuideLinks(chatId);
          const rendered = renderMenuPanel({ type: "general_guide", board, links, entryLinks: [] });
          console.log(
            JSON.stringify({
              chat_id: chatId,
              panel_type: panelType,
              rows: rendered.rows.map((r) => r.map((b) => b.text)),
              ok: true,
            }),
          );
        } else {
          const { links, entries } = await postingLinks(chatId);
          const rendered = renderMenuPanel({ type: "posting", board, links, entryLinks: entries });
          console.log(
            JSON.stringify({
              chat_id: chatId,
              panel_type: panelType,
              rows: rendered.rows.map((r) => r.map((b) => b.text)),
              ok: true,
            }),
          );
        }
      } catch (error) {
        console.log(
          JSON.stringify({
            chat_id: chatId,
            panel_type: panelType,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }
  await pool.end();
}

main().catch((error) => {
  console.error("DRY_RUN_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
