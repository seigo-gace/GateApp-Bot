import {
  pgTable,
  bigint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const blacklist = pgTable("blacklist", {
  user_id: bigint("user_id", { mode: "number" }).primaryKey(),
  status: text("status").notNull().default("blocked"), // blocked | temp_blocked | watch
  reason: text("reason"),
  source: text("source"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type Blacklist = typeof blacklist.$inferSelect;
export type InsertBlacklist = typeof blacklist.$inferInsert;
