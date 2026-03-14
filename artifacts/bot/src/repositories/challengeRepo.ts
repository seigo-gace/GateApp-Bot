import { db, bot_challenges } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { BotChallenge, InsertBotChallenge } from "../db/schema/bot_challenges.js";

export async function getChallengeByTarget(targetId: number): Promise<BotChallenge | undefined> {
  const rows = await db
    .select()
    .from(bot_challenges)
    .where(eq(bot_challenges.target_id, targetId));
  return rows[0];
}

export async function upsertChallenge(data: InsertBotChallenge): Promise<BotChallenge> {
  const existing = await getChallengeByTarget(data.target_id);
  if (existing) {
    const rows = await db
      .update(bot_challenges)
      .set({ ...data, updated_at: new Date() })
      .where(eq(bot_challenges.target_id, data.target_id))
      .returning();
    return rows[0]!;
  }
  const rows = await db.insert(bot_challenges).values(data).returning();
  return rows[0]!;
}
