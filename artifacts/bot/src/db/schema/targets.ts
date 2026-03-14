import { pgTable, serial, bigint, text, timestamp } from "drizzle-orm/pg-core";

export const targets = pgTable("targets", {
  target_id: serial("target_id").primaryKey(),
  owner_user_id: bigint("owner_user_id", { mode: "number" }).notNull(),
  target_type: text("target_type").notNull(), // entry_group | entry_channel | log_group
  chat_id: bigint("chat_id", { mode: "number" }).notNull(),
  title: text("title").notNull(),
  gate_code: text("gate_code").notNull().unique(),
  log_chat_id: bigint("log_chat_id", { mode: "number" }),
  log_thread_id: bigint("log_thread_id", { mode: "number" }),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type Target = typeof targets.$inferSelect;
export type InsertTarget = typeof targets.$inferInsert;
