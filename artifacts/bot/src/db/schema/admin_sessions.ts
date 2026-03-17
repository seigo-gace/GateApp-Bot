import {
  pgTable,
  bigint,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const admin_sessions = pgTable("admin_sessions", {
  tg_user_id: bigint("tg_user_id", { mode: "number" }).primaryKey(),
  state: text("state").notNull().default("top"),
  target_id: integer("target_id"),
  log_group_id: integer("log_group_id"),
  awaiting_input: text("awaiting_input"),
  temp_data: text("temp_data"),
  last_message_id: integer("last_message_id"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type AdminSession = typeof admin_sessions.$inferSelect;
export type InsertAdminSession = typeof admin_sessions.$inferInsert;
