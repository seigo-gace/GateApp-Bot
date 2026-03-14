import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const approvals = pgTable("approvals", {
  approval_id: serial("approval_id").primaryKey(),
  target_id: integer("target_id").notNull(),
  tg_user_id: bigint("tg_user_id", { mode: "number" }).notNull(),
  username: text("username"),
  display_name: text("display_name"),
  is_premium: boolean("is_premium").default(false),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | kicked
  rejected_reason: text("rejected_reason"),
  approved_at: timestamp("approved_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type Approval = typeof approvals.$inferSelect;
export type InsertApproval = typeof approvals.$inferInsert;
