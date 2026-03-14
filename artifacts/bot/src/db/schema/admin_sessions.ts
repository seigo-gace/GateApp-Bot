import {
  pgTable,
  bigint,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

// Tracks admin menu navigation state
export const admin_sessions = pgTable("admin_sessions", {
  tg_user_id: bigint("tg_user_id", { mode: "number" }).primaryKey(),
  state: text("state").notNull().default("top"), // top | add | list | ...
  target_id: integer("target_id"),
  log_group_id: integer("log_group_id"),
  awaiting_input: text("awaiting_input"), // what input is expected next
  temp_data: text("temp_data"), // JSON string for temp state
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type AdminSession = typeof admin_sessions.$inferSelect;
export type InsertAdminSession = typeof admin_sessions.$inferInsert;
