import "dotenv/config";
import { readConfiguredBotToken } from "./botToken.js";

// The same credential-loading interface is used by both GroupBot runtimes.
export const BOT_TOKEN = readConfiguredBotToken();

export const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required.");
}

// Admin user IDs (comma-separated in env) - optional, first user to /start becomes admin
export const ADMIN_USER_IDS: number[] = process.env.ADMIN_USER_IDS
  ? process.env.ADMIN_USER_IDS.split(",").map((id) => parseInt(id.trim(), 10))
  : [];

export const COOLDOWN_SECONDS = parseInt(
  process.env.COOLDOWN_SECONDS ?? "300",
  10
);
