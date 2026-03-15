import "dotenv/config";
import { Telegraf } from "telegraf";
import { BOT_TOKEN } from "./config/env.js";
import { registerStartHandler } from "./bot/startHandler.js";
import { registerMenuHandlers } from "./bot/menuHandlers.js";
import { registerGateHandlers } from "./bot/gateHandlers.js";
import { registerTextHandlers } from "./bot/textHandlers.js";
import { runMigrations } from "./db/migrate.js";
import { closePool } from "./db/index.js";
import * as sessionRepo from "./repositories/sessionRepo.js";

async function main() {
  console.log("Running database migrations...");
  await runMigrations();
  console.log("Migrations complete.");

  const bot = new Telegraf(BOT_TOKEN!);

  // Register handlers
  registerStartHandler(bot);
  registerGateHandlers(bot);
  registerMenuHandlers(bot);
  registerTextHandlers(bot);

  // Error handling with detailed logging
  bot.catch((err: unknown, ctx) => {
    const updateType = ctx.updateType;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[BOT_ERROR] ${updateType}: ${errorMsg}`);
    // Don't crash - bot continues processing other updates
  });

  // Clean up expired sessions periodically (every 5 minutes)
  const sessionCleanupInterval = setInterval(async () => {
    try {
      // Sessions older than 24 hours are automatically cleaned up
      const deleted = await sessionRepo.deleteExpiredSessions();
      if (deleted > 0) {
        console.log(`[CLEANUP] Removed ${deleted} expired sessions`);
      }
    } catch (err) {
      console.error("[CLEANUP] Session cleanup failed:", err);
    }
  }, 5 * 60 * 1000);

  // Launch (non-blocking - runs in background)
  bot.launch().catch((err) => {
    console.error("Bot launch error:", err);
    process.exit(1);
  });

  console.log("Bot started.");

  // Graceful shutdown
  const stopBot = async (signal: string) => {
    console.log(`[SHUTDOWN] Received ${signal}, gracefully stopping...`);
    clearInterval(sessionCleanupInterval);
    await bot.stop(signal);
    await closePool();
    console.log("[SHUTDOWN] Bot stopped successfully");
    process.exit(0);
  };

  process.once("SIGINT", () => stopBot("SIGINT"));
  process.once("SIGTERM", () => stopBot("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
