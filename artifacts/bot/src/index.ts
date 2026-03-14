import "dotenv/config";
import { Telegraf } from "telegraf";
import { BOT_TOKEN } from "./config/env.js";
import { registerStartHandler } from "./bot/startHandler.js";
import { registerMenuHandlers } from "./bot/menuHandlers.js";
import { registerGateHandlers } from "./bot/gateHandlers.js";
import { registerTextHandlers } from "./bot/textHandlers.js";
import { runMigrations } from "./db/migrate.js";

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

  // Error handling
  bot.catch((err: unknown, ctx) => {
    console.error(`Bot error for ${ctx.updateType}:`, err);
  });

  // Launch (non-blocking - runs in background)
  bot.launch().catch((err) => {
    console.error("Bot launch error:", err);
    process.exit(1);
  });

  console.log("Bot started.");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
