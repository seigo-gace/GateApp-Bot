import { db, blacklist } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { Blacklist, InsertBlacklist } from "../db/schema/blacklist.js";

export async function getBlacklisted(userId: number): Promise<Blacklist | undefined> {
  const rows = await db.select().from(blacklist).where(eq(blacklist.user_id, userId));
  return rows[0];
}

export async function addToBlacklist(data: InsertBlacklist): Promise<Blacklist> {
  const rows = await db
    .insert(blacklist)
    .values(data)
    .onConflictDoUpdate({
      target: blacklist.user_id,
      set: { status: data.status, reason: data.reason, updated_at: new Date() },
    })
    .returning();
  return rows[0]!;
}

export async function removeFromBlacklist(userId: number): Promise<void> {
  await db.delete(blacklist).where(eq(blacklist.user_id, userId));
}

export async function getAllBlacklist(): Promise<Blacklist[]> {
  return db.select().from(blacklist);
}
