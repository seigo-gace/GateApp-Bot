import { Telegraf, Markup } from "telegraf";
import * as ownerRepo from "../repositories/ownerRepo.js";
import * as targetRepo from "../repositories/targetRepo.js";
import * as approvalRepo from "../repositories/approvalRepo.js";
import * as sessionRepo from "../repositories/sessionRepo.js";
import * as blacklistRepo from "../repositories/blacklistRepo.js";
import { startGateFlow } from "./gateHandlers.js";
import { sendLog } from "../services/loggingService.js";
import { ADMIN_USER_IDS } from "../config/env.js";
import { topMenuKeyboard } from "./keyboards.js";

export function registerStartHandler(bot: Telegraf): void {
  bot.start(async (ctx) => {
    // Only process in private chats
    if (ctx.chat.type !== "private") {
      return;
    }
    
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    const payload = ctx.startPayload;

    // Gate flow
    if (payload.startsWith("gate_")) {
      const gateCode = payload.replace("gate_", "");
      const target = await targetRepo.getTargetByGateCode(gateCode);

      if (!target) {
        await ctx.reply("無効なリンクです。");
        return;
      }

      // 1. Blacklist check
      const bl = await blacklistRepo.getBlacklisted(userId);
      if (bl?.status === "blocked") {
        await sendLog(bot, {
          type: "blacklisted",
          targetTitle: target.title,
          userId,
          displayName,
          username,
          isPremium: (ctx.from as any).is_premium ?? false,
          logChatId: target.log_chat_id ? Number(target.log_chat_id) : null,
          logThreadId: target.log_thread_id ? Number(target.log_thread_id) : null,
        });
        await ctx.reply("参加できません。");
        return;
      }

      // 2. Username check
      if (!username) {
        await sendLog(bot, {
          type: "kicked",
          targetTitle: target.title,
          userId,
          displayName,
          isPremium: (ctx.from as any).is_premium ?? false,
          reason: "Username未設定",
          logChatId: target.log_chat_id ? Number(target.log_chat_id) : null,
          logThreadId: target.log_thread_id ? Number(target.log_thread_id) : null,
        });
        await ctx.reply(
          "ユーザーネーム未設定のため参加できません。Telegram設定でユーザーネームを作成後、もう一度やり直してください。"
        );

        // Kick from group if they're already there
        try {
          await ctx.telegram.banChatMember(target.chat_id, userId);
          await ctx.telegram.unbanChatMember(target.chat_id, userId);
        } catch {
          // ignore
        }
        return;
      }

      // Create approval record
      await approvalRepo.createApproval({
        target_id: target.target_id,
        tg_user_id: userId,
        username,
        display_name: displayName,
        is_premium: (ctx.from as any).is_premium ?? false,
        status: "pending",
      });

      try { await ctx.deleteMessage(); } catch {}
      await startGateFlow(ctx.telegram, userId, target.target_id, false);
      return;
    }

    // Admin flow
    let owner = await ownerRepo.getOwner(userId);

    if (!owner) {
      // First user or ADMIN_USER_IDS match
      const isAllowed =
        ADMIN_USER_IDS.length === 0 || ADMIN_USER_IDS.includes(userId);

      if (!isAllowed) {
        await ctx.reply("このBotは管理者専用です。");
        return;
      }

      owner = await ownerRepo.upsertOwner({
        owner_user_id: userId,
        display_name: displayName,
        role: "admin",
      });
    }

    await ctx.reply(`こんにちは、${owner.display_name}さん。\n管理メニューです。`, topMenuKeyboard());
  });
}
