import {
  pgTable,
  serial,
  integer,
  boolean,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const questions = pgTable("questions", {
  question_id: serial("question_id").primaryKey(),
  target_id: integer("target_id").notNull(),
  order_index: integer("order_index").notNull(), // 1, 2, 3
  enabled: boolean("enabled").notNull().default(false),
  question_text: text("question_text").notNull().default(""),
  button1_label: text("button1_label").notNull().default(""),
  button2_label: text("button2_label").notNull().default(""),
  button3_label: text("button3_label").notNull().default(""),
  correct_button: integer("correct_button").notNull().default(1), // 1, 2, or 3
  next_label: text("next_label").notNull().default("次へ"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type Question = typeof questions.$inferSelect;
export type InsertQuestion = typeof questions.$inferInsert;
