import "dotenv/config";
import { Telegraf } from "telegraf";
import { BOT_TOKEN } from "./config/env.js";
import { registerStartHandler } from "./bot/startHandler.js";
import { registerMenuHandlers } from "./bot/menuHandlers.js";
import { registerGateHandlers } from "./bot/gateHandlers.js";
import { registerTextHandlers } from "./bot/textHandlers.js";
import { runMigrations } from "./db/migrate.js";
import { closePool, pool } from "./db/index.js";
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

  // Health check and DB connection management (every 2 minutes)
  const healthCheckInterval = setInterval(async () => {
    try {
      const mem = process.memoryUsage();
      const memMb = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;
      
      // Test DB connection
      const result = await pool.query("SELECT 1");
      if (result.rows.length === 0) {
        console.warn("[HEALTH] DB query returned no rows");
      }
      
      console.log(`[HEALTH] Memory: ${memMb}MB | DB: OK | Idle connections: ${pool.idleCount}/${pool.totalCount}`);
      
      // Memory warning if > 500MB
      if (mem.heapUsed > 500 * 1024 * 1024) {
        console.warn(`[HEALTH] High memory usage: ${memMb}MB`);
      }
    } catch (err) {
      console.error("[HEALTH] Check failed:", err instanceof Error ? err.message : err);
      // Try to restart DB pool if connection fails
      try {
        console.log("[HEALTH] Attempting to drain and reconnect pool...");
        await pool.drain();
        console.log("[HEALTH] Pool drained and reconnected");
      } catch (drainErr) {
        console.error("[HEALTH] Pool drain failed:", drainErr);
      }
    }
  }, 2 * 60 * 1000);

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
    clearInterval(healthCheckInterval);
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
