import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const log_topics = pgTable("log_topics", {
  log_topic_id: serial("log_topic_id").primaryKey(),
  log_group_id: integer("log_group_id").notNull(),
  thread_id: bigint("thread_id", { mode: "number" }).notNull(),
  title: text("title").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type LogTopic = typeof log_topics.$inferSelect;
export type InsertLogTopic = typeof log_topics.$inferInsert;
