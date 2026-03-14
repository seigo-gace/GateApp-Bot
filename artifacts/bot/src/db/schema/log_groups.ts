import {
  pgTable,
  serial,
  bigint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const log_groups = pgTable("log_groups", {
  log_group_id: serial("log_group_id").primaryKey(),
  owner_user_id: bigint("owner_user_id", { mode: "number" }).notNull(),
  chat_id: bigint("chat_id", { mode: "number" }).notNull().unique(),
  title: text("title").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type LogGroup = typeof log_groups.$inferSelect;
export type InsertLogGroup = typeof log_groups.$inferInsert;
