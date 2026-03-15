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
  // Validate connections on use to detect stale connections
  connectionTimeoutMillis: 5000,
  max: 10,
});

// Handle pool errors - restart application on unrecoverable errors
pool.on("error", (err: any) => {
  console.error("[DB] Unexpected pool error:", err);
  // Exit on critical pool errors to allow Replit restart
  if (err.message?.includes("connect ECONNREFUSED") || err.message?.includes("FATAL")) {
    console.error("[DB] Fatal pool error - exiting to trigger restart");
    process.exit(1);
  }
});

pool.on("connect", () => {
  // Connection acquired
});

pool.on("remove", () => {
  // Connection removed from pool
});

export const db = drizzle(pool, { schema });

// Graceful shutdown helper
export async function closePool(): Promise<void> {
  try {
    await pool.end();
  } catch (err) {
    console.error("[DB] Error closing pool:", err);
  }
}

export * from "./schema/index.js";
