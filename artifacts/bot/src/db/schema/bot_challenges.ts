import {
  pgTable,
  serial,
  integer,
  boolean,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const bot_challenges = pgTable("bot_challenges", {
  challenge_id: serial("challenge_id").primaryKey(),
  target_id: integer("target_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  difficulty: text("difficulty").notNull().default("standard"), // easy | standard | hard
  max_fail: integer("max_fail").notNull().default(3),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type BotChallenge = typeof bot_challenges.$inferSelect;
export type InsertBotChallenge = typeof bot_challenges.$inferInsert;
