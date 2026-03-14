import * as blacklistRepo from "../repositories/blacklistRepo.js";
import type { Blacklist } from "../db/schema/blacklist.js";

export async function checkBlacklist(
  userId: number
): Promise<{ blocked: boolean; entry?: Blacklist }> {
  const entry = await blacklistRepo.getBlacklisted(userId);
  if (!entry) return { blocked: false };
  if (entry.status === "blocked") return { blocked: true, entry };
  return { blocked: false, entry };
}

export async function addToBlacklist(
  userId: number,
  status: "blocked" | "temp_blocked" | "watch",
  reason?: string,
  source?: string
): Promise<Blacklist> {
  return blacklistRepo.addToBlacklist({ user_id: userId, status, reason, source });
}

export async function removeFromBlacklist(userId: number): Promise<void> {
  return blacklistRepo.removeFromBlacklist(userId);
}

export async function getAllBlacklist(): Promise<Blacklist[]> {
  return blacklistRepo.getAllBlacklist();
}
