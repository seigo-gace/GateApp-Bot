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

let dbFailCount = 0;
const MAX_DB_FAILS = 3;

async function main() {
  console.log("Running database migrations...");
  await runMigrations();
  console.log("Migrations complete.");

  const bot = new Telegraf(BOT_TOKEN!);

  registerStartHandler(bot);
  registerGateHandlers(bot);
  registerMenuHandlers(bot);
  registerTextHandlers(bot);

  bot.catch((err: unknown, ctx) => {
    const updateType = ctx.updateType;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[BOT_ERROR] ${updateType}: ${errorMsg}`);
  });

  const healthCheckInterval = setInterval(async () => {
    try {
      const mem = process.memoryUsage();
      const memMb = Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100;

      const result = await pool.query("SELECT 1");
      if (result.rows.length === 0) {
        console.warn("[HEALTH] DB query returned no rows");
      }

      dbFailCount = 0;
      console.log(`[HEALTH] Memory: ${memMb}MB | DB: OK | Pool: ${pool.idleCount}/${pool.totalCount}`);

      if (mem.heapUsed > 500 * 1024 * 1024) {
        console.warn(`[HEALTH] High memory usage: ${memMb}MB`);
      }
    } catch (err) {
      dbFailCount++;
      console.error(`[HEALTH] DB check failed (${dbFailCount}/${MAX_DB_FAILS}):`, err instanceof Error ? err.message : err);

      if (dbFailCount >= MAX_DB_FAILS) {
        console.error("[HEALTH] DB connection failed too many times. Exiting for auto-restart...");
        process.exit(1);
      }

      try {
        await pool.drain();
        console.log("[HEALTH] Pool drained for reconnect");
      } catch (drainErr) {
        console.error("[HEALTH] Pool drain failed:", drainErr);
      }
    }
  }, 2 * 60 * 1000);

  const sessionCleanupInterval = setInterval(async () => {
    try {
      const deleted = await sessionRepo.deleteExpiredSessions();
      if (deleted > 0) {
        console.log(`[CLEANUP] Removed ${deleted} expired sessions`);
      }
    } catch (err) {
      console.error("[CLEANUP] Session cleanup failed:", err);
    }
  }, 5 * 60 * 1000);

  bot.launch({
    dropPendingUpdates: true,
    allowedUpdates: ["message", "callback_query", "chat_member", "chat_shared"],
  }).catch((err) => {
    console.error("Bot launch error:", err);
    process.exit(1);
  });

  console.log("Bot started. PID:", process.pid);

  const stopBot = async (signal: string) => {
    console.log(`[SHUTDOWN] Received ${signal}, gracefully stopping...`);
    clearInterval(sessionCleanupInterval);
    clearInterval(healthCheckInterval);
    try {
      await bot.stop(signal);
    } catch (e) {
      console.error("[SHUTDOWN] bot.stop error:", e);
    }
    try {
      await closePool();
    } catch (e) {
      console.error("[SHUTDOWN] closePool error:", e);
    }
    console.log("[SHUTDOWN] Bot stopped successfully");
    process.exit(0);
  };

  process.once("SIGINT", () => stopBot("SIGINT"));
  process.once("SIGTERM", () => stopBot("SIGTERM"));
}

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
