import { db, targets } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import type { InsertTarget, Target } from "../db/schema/targets.js";

export async function createTarget(data: InsertTarget): Promise<Target> {
  const rows = await db.insert(targets).values(data).returning();
  return rows[0]!;
}

export async function getTargetById(targetId: number): Promise<Target | undefined> {
  const rows = await db.select().from(targets).where(eq(targets.target_id, targetId));
  return rows[0];
}

export async function getTargetByGateCode(gateCode: string): Promise<Target | undefined> {
  const rows = await db.select().from(targets).where(eq(targets.gate_code, gateCode));
  return rows[0];
}

export async function getEntryTargetsByOwner(ownerUserId: number): Promise<Target[]> {
  return db
    .select()
    .from(targets)
    .where(
      and(
        eq(targets.owner_user_id, ownerUserId),
        // entry_group or entry_channel
      )
    );
}

export async function getAllEntryTargets(): Promise<Target[]> {
  return db
    .select()
    .from(targets)
    .where(
      eq(targets.target_type, "entry_group")
    )
    .then(async (groups) => {
      const channels = await db
        .select()
        .from(targets)
        .where(eq(targets.target_type, "entry_channel"));
      return [...groups, ...channels];
    });
}

export async function getEntryTargetsByUserId(ownerUserId: number): Promise<Target[]> {
  const groups = await db
    .select()
    .from(targets)
    .where(and(eq(targets.owner_user_id, ownerUserId), eq(targets.target_type, "entry_group")));
  const channels = await db
    .select()
    .from(targets)
    .where(and(eq(targets.owner_user_id, ownerUserId), eq(targets.target_type, "entry_channel")));
  return [...groups, ...channels];
}

export async function getAllLogGroups(): Promise<Target[]> {
  return db.select().from(targets).where(eq(targets.target_type, "log_group"));
}

export async function getLogGroupsByUserId(ownerUserId: number): Promise<Target[]> {
  return db
    .select()
    .from(targets)
    .where(and(eq(targets.owner_user_id, ownerUserId), eq(targets.target_type, "log_group")));
}

export async function updateTarget(
  targetId: number,
  data: Partial<InsertTarget>
): Promise<Target | undefined> {
  const rows = await db
    .update(targets)
    .set({ ...data, updated_at: new Date() })
    .where(eq(targets.target_id, targetId))
    .returning();
  return rows[0];
}

export async function deleteTarget(targetId: number): Promise<void> {
  await db.delete(targets).where(eq(targets.target_id, targetId));
}
