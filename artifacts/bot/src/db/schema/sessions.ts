import {
  pgTable,
  bigint,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const gate_sessions = pgTable("gate_sessions", {
  tg_user_id: bigint("tg_user_id", { mode: "number" }).primaryKey(),
  target_id: integer("target_id").notNull(),
  step: text("step").notNull().default("start"),
  challenge_fails: integer("challenge_fails").notNull().default(0),
  challenge_data: jsonb("challenge_data"),
  last_message_id: integer("last_message_id"),
  last_attempt: timestamp("last_attempt"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type GateSession = typeof gate_sessions.$inferSelect;
export type InsertGateSession = typeof gate_sessions.$inferInsert;
