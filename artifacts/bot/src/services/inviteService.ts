import { Telegraf } from "telegraf";
import * as inviteRepo from "../repositories/inviteRepo.js";
import type { InviteLink } from "../db/schema/invite_links.js";

export async function createInviteLink(
  bot: Telegraf,
  targetId: number,
  chatId: number,
  userId: number
): Promise<InviteLink> {
  const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const link = await (bot.telegram as any).createChatInviteLink(chatId, {
    member_limit: 1,
    expire_date: Math.floor(expireAt.getTime() / 1000),
    creates_join_request: false,
  });

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
