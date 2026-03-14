import { db, owners } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { InsertOwner, Owner } from "../db/schema/owners.js";

export async function getOwner(userId: number): Promise<Owner | undefined> {
  const rows = await db.select().from(owners).where(eq(owners.owner_user_id, userId));
  return rows[0];
}

export async function upsertOwner(data: InsertOwner): Promise<Owner> {
  const rows = await db
    .insert(owners)
    .values(data)
    .onConflictDoUpdate({
      target: owners.owner_user_id,
      set: { display_name: data.display_name },
    })
    .returning();
  return rows[0]!;
}

export async function getAllOwners(): Promise<Owner[]> {
  return db.select().from(owners);
}
