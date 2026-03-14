import { pgTable, bigint, text, timestamp } from "drizzle-orm/pg-core";

export const owners = pgTable("owners", {
  owner_user_id: bigint("owner_user_id", { mode: "number" }).primaryKey(),
  display_name: text("display_name").notNull(),
  role: text("role").notNull().default("admin"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export type Owner = typeof owners.$inferSelect;
export type InsertOwner = typeof owners.$inferInsert;
