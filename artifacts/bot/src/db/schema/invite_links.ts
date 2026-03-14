import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const invite_links = pgTable("invite_links", {
  invite_id: serial("invite_id").primaryKey(),
  target_id: integer("target_id").notNull(),
  tg_user_id: bigint("tg_user_id", { mode: "number" }).notNull(),
  invite_link: text("invite_link").notNull(),
  expire_at: timestamp("expire_at").notNull(),
  used_at: timestamp("used_at"),
  revoked_at: timestamp("revoked_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export type InviteLink = typeof invite_links.$inferSelect;
export type InsertInviteLink = typeof invite_links.$inferInsert;
