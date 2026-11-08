/**
 * Publish verified L1 topic boards (national / video / category) and sync L0 nav URLs.
 */
import "dotenv/config";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { Telegraf } from "telegraf";
import { readConfiguredBotToken } from "../src/config/botToken.js";
import { pool, closePool } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { publishVerifiedTopicBoard } from "../src/bot/topicBoardHandlers.js";
import {
  AREA_BLOCKS,
  AREA_CHAT_ID,
  blockBoardKey,
  messageIdFromBoardUrl,
  resolveBlockChildUrlsPartial,
} from "../src/services/topicBoardContent.js";
import { guideMessageUrl } from "../src/services/guideMessageUrl.js";

const ADMIN = Number(process.env.MENU_PUBLISH_ADMIN_ID ?? "7880448530");
const ledgerPath =
  process.env.TOPIC_BOARD_LEDGER_PATH ??
  (fs.existsSync("/app/topic-board-ledger-v1.json")
    ? "/app/topic-board-ledger-v1.json"
    : path.join(process.cwd(), "deploy/topic-board-ledger-v1.json"));
const LEDGER = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
  boards: {
    board_key: string;
    chat_id: number;
    message_thread_id: number;
    guide_link_key: string;
    guide_label: string;
  }[];
  guide_chats: number[];
};

async function seedAreaLinks(): Promise<number> {
  let n = 0;
  for (const block of AREA_BLOCKS) {
    for (const child of block.children) {
      if (!child.url) continue;
      const row = await pool.query(
        `INSERT INTO topic_board_area_links(block_name,area_name,target_url,verified_by)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(block_name,area_name) DO UPDATE SET
           target_url=EXCLUDED.target_url,verified_by=EXCLUDED.verified_by,verified_at=NOW()
         WHERE topic_board_area_links.target_url=EXCLUDED.target_url
         RETURNING block_name`,
        [block.label, child.label, child.url, ADMIN],
      );
      if (row.rowCount === 1) n += 1;
    }
  }
  return n;
}

async function main(): Promise<void> {
  if (process.env.GAYBBS_TOPIC_BOARD_RELEASE !== "enabled")
    throw new Error("TOPIC_BOARD_RELEASE_DISABLED");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  await runMigrations();
  const bot = new Telegraf(readConfiguredBotToken(), {
    telegram: { agent: new https.Agent({ keepAlive: true, family: 4 }) },
  });
  const areaSeeded = await seedAreaLinks();
  const dbRows = await pool.query("SELECT block_name, area_name, target_url FROM topic_board_area_links");
  const dbMap: Record<string, string> = {};
  for (const row of dbRows.rows) {
    dbMap[`${row.block_name}/${row.area_name}`] = String(row.target_url);
  }
  const blockResults: Record<string, number> = {};
  const nationalEntry = LEDGER.boards.find((b) => b.board_key === "national")!;
  await pool.query(
    `INSERT INTO topic_board_posts(board_key,chat_id,message_thread_id,verified_by,state)
     VALUES ($1,$2,$3,$4,'verified')
     ON CONFLICT(board_key) DO NOTHING`,
    ["national", nationalEntry.chat_id, nationalEntry.message_thread_id, ADMIN],
  );
  const nationalWarm = await publishVerifiedTopicBoard(
    bot.telegram,
    "national",
    nationalEntry.chat_id,
    nationalEntry.message_thread_id,
    ADMIN,
  );
  console.log(JSON.stringify({ phase: "national_warm", message_id: nationalWarm.messageId }));
  await pool.query(
    `UPDATE board_menu_panels SET state='published',message_id=$2,pinned=TRUE,
      revision=revision+1,updated_at=NOW()
     WHERE chat_id=$1 AND panel_type='general_guide' AND message_thread_id=$3`,
    [nationalEntry.chat_id, nationalWarm.messageId, nationalEntry.message_thread_id],
  );
  for (const block of AREA_BLOCKS) {
    const resolved = resolveBlockChildUrlsPartial(block.label, dbMap);
    if (Object.keys(resolved).length === 0) {
      console.log(JSON.stringify({ block_skipped: block.label, reason: "AREA_BLOCK_NO_VERIFIED_CHILDREN" }));
      continue;
    }
    const key = blockBoardKey(block.label);
    const threadId = messageIdFromBoardUrl(block.url);
    await pool.query(
      `INSERT INTO topic_board_posts(board_key,chat_id,message_thread_id,verified_by,state)
       VALUES ($1,$2,$3,$4,'verified')
       ON CONFLICT(board_key) DO UPDATE SET
         chat_id=EXCLUDED.chat_id,message_thread_id=EXCLUDED.message_thread_id,
         verified_by=EXCLUDED.verified_by,verified_at=NOW(),updated_at=NOW()
       WHERE topic_board_posts.state IN ('verified','published','needs_reconcile')`,
      [key, AREA_CHAT_ID, threadId, ADMIN],
    );
    const result = await publishVerifiedTopicBoard(
      bot.telegram,
      key,
      AREA_CHAT_ID,
      threadId,
      ADMIN,
    );
    console.log(
      JSON.stringify({
        block_published: block.label,
        verified_child_links: Object.keys(resolved).length,
        pending_child_links: block.children.length - Object.keys(resolved).length,
      }),
    );
    blockResults[block.label] = result.messageId;
    console.log(
      JSON.stringify({
        board_key: key,
        chat_id: AREA_CHAT_ID,
        message_thread_id: threadId,
        message_id: result.messageId,
        inline_keyboard_rows: "renderAreaBlockBoard",
      }),
    );
  }
  const published: Record<string, { message_id: number; destination_url: string }> = {};
  for (const board of LEDGER.boards) {
    await pool.query(
      `INSERT INTO topic_board_posts(board_key,chat_id,message_thread_id,verified_by,state)
       VALUES($1,$2,$3,$4,'verified')
       ON CONFLICT(board_key) DO UPDATE SET
         chat_id=EXCLUDED.chat_id,message_thread_id=EXCLUDED.message_thread_id,
         verified_by=EXCLUDED.verified_by,verified_at=NOW(),updated_at=NOW()
       WHERE topic_board_posts.state IN ('verified','published','needs_reconcile')`,
      [board.board_key, board.chat_id, board.message_thread_id, ADMIN],
    );
    const result = await publishVerifiedTopicBoard(
      bot.telegram,
      board.board_key,
      board.chat_id,
      board.message_thread_id,
      ADMIN,
    );
    const url = guideMessageUrl(board.chat_id, result.messageId);
    published[board.guide_link_key] = { message_id: result.messageId, destination_url: url };
    console.log(
      JSON.stringify({
        board_key: board.board_key,
        chat_id: board.chat_id,
        message_thread_id: board.message_thread_id,
        message_id: result.messageId,
        updated_existing: result.updatedExisting,
        destination_url: url,
      }),
    );
  }
  for (const [linkKey, meta] of Object.entries(published)) {
    const label = LEDGER.boards.find((b) => b.guide_link_key === linkKey)?.guide_label;
    if (!label) continue;
    for (const chatId of LEDGER.guide_chats) {
      await pool.query(
        `UPDATE general_guide_links SET destination_url=$3,verified_by=$4,verified_at=NOW()
         WHERE chat_id=$1 AND link_key=$2 AND enabled=TRUE`,
        [chatId, linkKey, meta.destination_url, ADMIN],
      );
    }
  }
  console.log(
    JSON.stringify({
      area_links_seeded: areaSeeded,
      area_blocks_published: blockResults,
      l0_nav_synced: published,
    }),
  );
  await closePool();
}

main().catch((error) => {
  console.error("TOPIC_BOARD_PUBLISH_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
