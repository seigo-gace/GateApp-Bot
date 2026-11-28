import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: "telegram_gate_bot",
});

pool.on("error", (err: any) => {
  console.error("[DB] Unexpected pool error:", err);
  if (err.message?.includes("connect ECONNREFUSED") || err.message?.includes("FATAL")) {
    console.error("[DB] Fatal pool error - exiting to trigger restart");
    process.exit(1);
  }
});

/** Only the dedicated GayBBS runtime calls this before its first connection.
 * PostgreSQL cancels blocked statements at the server, not just the caller. */
export function configureGaybbsDatabaseWaits():void{
 if(pool.totalCount!==0)throw Error("GAYBBS_DB_POOL_ALREADY_OPEN");
 Object.assign(pool.options,{lock_timeout:5000,statement_timeout:60000});
}

export const db = drizzle(pool, { schema });

export async function closePool(): Promise<void> {
  try {
    await pool.end();
  } catch (err) {
    console.error("[DB] Error closing pool:", err);
  }
}

export * from "./schema/index.js";
