import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const rules = pgTable("rules", {
  rule_id: serial("rule_id").primaryKey(),
  target_id: integer("target_id").notNull().unique(),
  rule_text: text("rule_text").notNull().default(""),
  accept_label: text("accept_label").notNull().default("同意する"),
  reject_label: text("reject_label").notNull().default("同意しない"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type Rule = typeof rules.$inferSelect;
export type InsertRule = typeof rules.$inferInsert;
