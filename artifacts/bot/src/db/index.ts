import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

// Optimized connection pool for production stability
// max: Keep connections low to avoid resource exhaustion
// idleTimeoutMillis: Close idle connections to free resources
// connectionTimeoutMillis: Fast-fail on connection timeout
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: "telegram_gate_bot",
});

// Handle pool errors
pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err);
});

pool.on("connect", () => {
  // Connection acquired - can add custom setup if needed
});

export const db = drizzle(pool, { schema });

// Graceful shutdown helper
export async function closePool(): Promise<void> {
  await pool.end();
}

export * from "./schema/index.js";
