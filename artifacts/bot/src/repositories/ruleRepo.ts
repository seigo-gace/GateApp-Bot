import { db, rules } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { Rule, InsertRule } from "../db/schema/rules.js";

export async function getRuleByTarget(targetId: number): Promise<Rule | undefined> {
  const rows = await db.select().from(rules).where(eq(rules.target_id, targetId));
  return rows[0];
}

export async function upsertRule(data: InsertRule): Promise<Rule> {
  const existing = await getRuleByTarget(data.target_id);
  if (existing) {
    const rows = await db
      .update(rules)
      .set({ ...data, updated_at: new Date() })
      .where(eq(rules.target_id, data.target_id))
      .returning();
    return rows[0]!;
  }
  const rows = await db.insert(rules).values(data).returning();
  return rows[0]!;
}
