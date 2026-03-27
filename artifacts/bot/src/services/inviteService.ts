import { Telegraf } from "telegraf";
import * as inviteRepo from "../repositories/inviteRepo.js";
import * as targetRepo from "../repositories/targetRepo.js";
import type { InviteLink } from "../db/schema/invite_links.js";

function formatInviteName(counter: number): string {
  const num = counter + 1;
  if (num <= 99) return `DC_GATEjp=${String(num).padStart(2, "0")}`;
  if (num <= 999) return `DC_GATEjp=${String(num).padStart(3, "0")}`;
  return `DC_GATEjp=${String(num).padStart(4, "0")}`;
}

export async function createInviteLink(
  bot: Telegraf,
  targetId: number,
  chatId: number,
  userId: number
): Promise<InviteLink> {
  const target = await targetRepo.getTargetById(targetId);
  const currentCounter = target?.invite_counter ?? 0;
  const linkName = formatInviteName(currentCounter);

  const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const link = await (bot.telegram as any).createChatInviteLink(chatId, {
    name: linkName,
    member_limit: 1,
    expire_date: Math.floor(expireAt.getTime() / 1000),
    creates_join_request: false,
  });

  await targetRepo.updateTarget(targetId, { invite_counter: currentCounter + 1 });

  return inviteRepo.createInviteLink({
    target_id: targetId,
    tg_user_id: userId,
    invite_link: link.invite_link,
    expire_at: expireAt,
  });
}

export async function revokeInviteLink(
  bot: Telegraf,
  chatId: number,
  inviteLink: string,
  inviteId: number
): Promise<void> {
  try {
    await (bot.telegram as any).revokeChatInviteLink(chatId, inviteLink);
  } catch (err: any) {
    console.error(`[INVITE] Failed to revoke link: ${err.message}`);
  }
  await inviteRepo.revokeInviteLink(inviteId);
}

export async function validateAndUseInviteLink(
  bot: Telegraf,
  inviteLinkUrl: string,
  attemptingUserId: number,
  chatId: number
): Promise<{ valid: boolean; owned: boolean; inviteId?: number }> {
  const link = await inviteRepo.getInviteLinkByUrl(inviteLinkUrl);

  if (!link) {
    return { valid: false, owned: false };
  }

  const isOwner = link.tg_user_id === attemptingUserId;

  if (!isOwner) {
    try {
      await (bot.telegram as any).revokeChatInviteLink(chatId, inviteLinkUrl);
    } catch (err) {}
    await inviteRepo.revokeInviteLink(link.invite_id);
    return { valid: false, owned: false };
  }

  await inviteRepo.markInviteLinkUsed(link.invite_id);
  return { valid: true, owned: true, inviteId: link.invite_id };
}
