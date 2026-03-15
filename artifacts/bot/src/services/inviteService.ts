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

// 招待リンク検証：ユーザー ID と期限を確認
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
    // 本人でない場合、リンク無効化して拒否
    try {
      await (bot.telegram as any).revokeChatInviteLink(chatId, inviteLinkUrl);
    } catch (err) {
      // Ignore revoke errors
    }
    await inviteRepo.revokeInviteLink(link.invite_id);
    return { valid: false, owned: false };
  }

  // 本人の場合、リンク使用済みマーク
  await inviteRepo.markInviteLinkUsed(link.invite_id);
  return { valid: true, owned: true, inviteId: link.invite_id };
}
