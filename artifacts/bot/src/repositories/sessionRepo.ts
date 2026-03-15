import { db, gate_sessions, admin_sessions } from "../db/index.js";
import { eq, lte } from "drizzle-orm";
import type { GateSession, InsertGateSession } from "../db/schema/sessions.js";
import type { AdminSession, InsertAdminSession } from "../db/schema/admin_sessions.js";

// Gate sessions
export async function getGateSession(userId: number): Promise<GateSession | undefined> {
  const rows = await db
    .select()
    .from(gate_sessions)
    .where(eq(gate_sessions.tg_user_id, userId));
  return rows[0];
}

export async function upsertGateSession(data: InsertGateSession): Promise<GateSession> {
  const rows = await db
    .insert(gate_sessions)
    .values(data)
    .onConflictDoUpdate({
      target: gate_sessions.tg_user_id,
      set: { ...data, updated_at: new Date() },
    })
    .returning();
  return rows[0]!;
}

export async function deleteGateSession(userId: number): Promise<void> {
  await db.delete(gate_sessions).where(eq(gate_sessions.tg_user_id, userId));
}

export async function deleteExpiredSessions(): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db
    .delete(gate_sessions)
    .where(lte(gate_sessions.created_at, oneDayAgo));
  const adminResult = await db
    .delete(admin_sessions)
    .where(lte(admin_sessions.created_at, oneDayAgo));
  return (result.rowCount || 0) + (adminResult.rowCount || 0);
}

// Admin sessions
export async function getAdminSession(userId: number): Promise<AdminSession | undefined> {
  const rows = await db
    .select()
    .from(admin_sessions)
    .where(eq(admin_sessions.tg_user_id, userId));
  return rows[0];
}

export async function upsertAdminSession(data: InsertAdminSession): Promise<AdminSession> {
  const rows = await db
    .insert(admin_sessions)
    .values(data)
    .onConflictDoUpdate({
      target: admin_sessions.tg_user_id,
      set: { ...data, updated_at: new Date() },
    })
    .returning();
  return rows[0]!;
}
