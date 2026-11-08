/**
 * Admin operator: publish verified board_menu_panels via Bot API (same logic as /publishpanel).
 * Requires GAYBBS_PUBLIC_MENU_RELEASE=enabled and DATABASE_URL + BOT_TOKEN_FILE.
 */
import "dotenv/config";
import https from "node:https";
import { Telegraf } from "telegraf";
import { readConfiguredBotToken } from "../src/config/botToken.js";
import { pool, closePool } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { publishExistingMenuPanel } from "../src/services/menuPanelPublisher.js";

const ADMIN = Number(process.env.MENU_PUBLISH_ADMIN_ID ?? "7880448530");

async function main(): Promise<void> {
  if (process.env.GAYBBS_PUBLIC_MENU_RELEASE !== "enabled") {
    throw new Error("PUBLIC_MENUS_NOT_RELEASED");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  await runMigrations();
  const bot = new Telegraf(readConfiguredBotToken(), {
    telegram: { agent: new https.Agent({ keepAlive: true, family: 4 }) },
  });
  const onlyPosting = process.env.MENU_PUBLISH_PANEL_TYPES === "posting";
  const panels = await pool.query<{
    chat_id: string;
    message_thread_id: string;
    panel_type: string;
    state: string;
  }>(
    onlyPosting
      ? `SELECT chat_id,message_thread_id,panel_type,state
         FROM board_menu_panels
         WHERE panel_type='posting' AND state IN ('verified','published')
         ORDER BY chat_id`
      : `SELECT chat_id,message_thread_id,panel_type,state
         FROM board_menu_panels
         WHERE state IN ('verified','published')
         ORDER BY chat_id,panel_type`,
  );
  if (!panels.rows.length) throw new Error("NO_VERIFIED_PANELS");
  for (const row of panels.rows) {
    const chatId = Number(row.chat_id);
    const threadId = Number(row.message_thread_id);
    const result = await publishExistingMenuPanel(bot.telegram, chatId, threadId, ADMIN);
    console.log(
      JSON.stringify({
        chat_id: chatId,
        message_thread_id: threadId,
        panel_type: row.panel_type,
        message_id: result.messageId,
        updated_existing: result.updatedExisting,
      }),
    );
  }
  await closePool();
}

main().catch((error) => {
  console.error(
    "MENU_PUBLISH_FAILED",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
