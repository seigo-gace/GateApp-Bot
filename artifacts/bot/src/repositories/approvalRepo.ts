import { db, approvals } from "../db/index.js";
import { eq, and, desc } from "drizzle-orm";
import type { Approval, InsertApproval } from "../db/schema/approvals.js";

export async function createApproval(data: InsertApproval): Promise<Approval> {
  const rows = await db.insert(approvals).values(data).returning();
  return rows[0]!;
}

export async function getLatestApproval(
  targetId: number,
  userId: number
): Promise<Approval | undefined> {
  const rows = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.target_id, targetId), eq(approvals.tg_user_id, userId)))
    .orderBy(desc(approvals.created_at))
    .limit(1);
  return rows[0];
}

export async function updateApproval(
  approvalId: number,
  data: Partial<InsertApproval>
): Promise<Approval | undefined> {
  const rows = await db
    .update(approvals)
    .set({ ...data, updated_at: new Date() })
    .where(eq(approvals.approval_id, approvalId))
    .returning();
  return rows[0];
}
