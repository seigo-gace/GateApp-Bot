import { db, invite_links } from "../db/index.js";
import { eq, and, isNull } from "drizzle-orm";
import type { InviteLink, InsertInviteLink } from "../db/schema/invite_links.js";

export async function createInviteLink(data: InsertInviteLink): Promise<InviteLink> {
  const rows = await db.insert(invite_links).values(data).returning();
  return rows[0]!;
}

export async function getActiveInviteLink(
  targetId: number,
  userId: number
): Promise<InviteLink | undefined> {
  const now = new Date();
  const rows = await db
    .select()
    .from(invite_links)
    .where(
      and(
        eq(invite_links.target_id, targetId),
        eq(invite_links.tg_user_id, userId),
        isNull(invite_links.used_at),
        isNull(invite_links.revoked_at)
      )
    )
    .limit(1);
  return rows.find((r) => r.expire_at > now);
}

export async function markInviteLinkUsed(inviteId: number): Promise<void> {
  await db
    .update(invite_links)
    .set({ used_at: new Date() })
    .where(eq(invite_links.invite_id, inviteId));
}

export async function revokeInviteLink(inviteId: number): Promise<void> {
  await db
    .update(invite_links)
    .set({ revoked_at: new Date() })
    .where(eq(invite_links.invite_id, inviteId));
}
