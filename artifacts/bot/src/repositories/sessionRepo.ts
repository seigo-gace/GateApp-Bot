import { db, gate_sessions, admin_sessions } from "../db/index.js";
import { eq } from "drizzle-orm";
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
