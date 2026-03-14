import "dotenv/config";

export const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required.");
}

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
