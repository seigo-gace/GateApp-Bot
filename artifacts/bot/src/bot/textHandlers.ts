import { Telegraf, Markup } from "telegraf";
import * as sessionRepo from "../repositories/sessionRepo.js";
import * as targetRepo from "../repositories/targetRepo.js";
import * as questionRepo from "../repositories/questionRepo.js";
import * as ruleRepo from "../repositories/ruleRepo.js";
import * as logGroupRepo from "../repositories/logGroupRepo.js";
import * as blacklistRepo from "../repositories/blacklistRepo.js";
import * as ownerRepo from "../repositories/ownerRepo.js";
import { generateGateCode } from "../utils/gateCode.js";
import { adminManageKeyboard } from "./keyboards.js";

export function registerTextHandlers(bot: Telegraf): void {
  bot.on("message", async (ctx) => {
    const userId = ctx.from!.id;
    const msg = ctx.message as any;
    const adminSession = await sessionRepo.getAdminSession(userId);

    // ─── chat_shared: Telegram native chat picker result ───
    if (msg.chat_shared && adminSession?.state === "awaiting_chat_select" && adminSession.awaiting_input) {
      const type = adminSession.awaiting_input as string;
      const chatShared = msg.chat_shared as { request_id: number; chat_id: number; title?: string; username?: string };
      const chatId = chatShared.chat_id;
      const title = chatShared.title ?? chatShared.username ?? `Chat ${chatId}`;
      const botUsername = (await ctx.telegram.getMe()).username!;
      const me = await ctx.telegram.getMe();
      const botId = me.id;

      // Remove the reply keyboard
      await ctx.reply("選択中...", Markup.removeKeyboard());

      await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "top", awaiting_input: null, temp_data: null });

      // ─── CHECK: Is bot already a member of the chat? ───
      let botIsMember = false;
      try {
        const botMember = await ctx.telegram.getChatMember(chatId, botId);
        botIsMember = !["left", "kicked"].includes(botMember.status);
      } catch (err: any) {
        // Chat not found or bot has no access
        botIsMember = false;
      }

      if (!botIsMember) {
        // ─── BOT NOT IN CHAT: Show deep link to add bot ───
        const isChannel = type === "entry_channel";
        const deepLink = isChannel
          ? `https://t.me/${botUsername}?startchannel=${type}`
          : `https://t.me/${botUsername}?startgroup=${type}`;

        await ctx.reply(
          `⚠️ Botがまだこのチャットに参加していません。\n\n下のリンクからBotをグループ/チャンネルに追加してください。その後、もう一度この操作をしてください。`,
          Markup.inlineKeyboard([
            [Markup.button.url("🔧 Botをグループに追加", deepLink)],
            [Markup.button.callback("メインメニュー", "menu:top")],
          ])
        );
        return;
      }

      // ─── BOT IS ALREADY IN CHAT: Try to promote to admin ───
      if (type === "log_group") {
        const existing = await logGroupRepo.getLogGroupByChatId(chatId);
        if (existing) {
          await ctx.reply(
            `「${title}」はすでにロググループとして登録されています。`,
            Markup.inlineKeyboard([
              [Markup.button.callback("詳細を見る", `lg:detail:${existing.log_group_id}`)],
              [Markup.button.callback("メインメニュー", "menu:top")],
            ])
          );
          return;
        }

        const lg = await logGroupRepo.createLogGroup({
          owner_user_id: userId,
          chat_id: chatId,
          title,
        });

        // Bot is in chat, now promote to admin
        const autoAdminResult = await tryPromoteAdmin(ctx.telegram, chatId, "log_group");

        // Import logGroupTopicSelectKeyboard
        const { logGroupTopicSelectKeyboard } = await import("./keyboards.js");

        await ctx.reply(
          `ロググループ「${title}」を登録しました。\n\n${autoAdminResult.message}\n\nトピックを設定しますか？`,
          logGroupTopicSelectKeyboard(lg.log_group_id)
        );
      } else {
        const existing = await targetRepo.getTargetByChatId(chatId);
        if (existing) {
          await ctx.reply(
            `「${title}」はすでに登録されています。`,
            Markup.inlineKeyboard([
              [Markup.button.callback("詳細を見る", `target:detail:${existing.target_id}`)],
              [Markup.button.callback("メインメニュー", "menu:top")],
            ])
          );
          return;
        }

        const gateCode = generateGateCode();
        const newTarget = await targetRepo.createTarget({
          owner_user_id: userId,
          target_type: type,
          chat_id: chatId,
          title,
          gate_code: gateCode,
        });

        // Create defaults
        const { upsertChallenge } = await import("../repositories/challengeRepo.js");
        await upsertChallenge({ target_id: newTarget.target_id, enabled: true, difficulty: "standard", max_fail: 3 });
        for (let i = 1; i <= 3; i++) {
          await questionRepo.upsertQuestion({
            target_id: newTarget.target_id,
            order_index: i,
            enabled: false,
            question_text: "",
            button1_label: "",
            button2_label: "",
            button3_label: "",
            correct_button: 1,
            next_label: "次へ",
          });
        }
        await ruleRepo.upsertRule({ target_id: newTarget.target_id, rule_text: "", accept_label: "同意する", reject_label: "同意しない" });

        const gateLink = `https://t.me/${botUsername}?start=gate_${gateCode}`;
        const isChannel = type === "entry_channel";

        // Bot is in chat, now promote to admin
        const autoAdminResult = await tryPromoteAdmin(ctx.telegram, chatId, type);

        await ctx.reply(
          `「${title}」を登録しました。\n\n${autoAdminResult.message}\n\nゲートリンク:\n${gateLink}`,
          buildPostRegisterKeyboard(autoAdminResult.success, botUsername, chatId, isChannel, newTarget.target_id, null)
        );
      }
      return;
    }

    // ─── awaiting_text inputs ───
    if (adminSession?.state === "awaiting_text" && adminSession.awaiting_input) {
      const input = adminSession.awaiting_input as string;
      const text = (msg.text as string | undefined)?.trim();

      if (!text) {
        await ctx.reply("テキストを送信してください。");
        return;
      }

      await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "top", awaiting_input: null, temp_data: null });

      // Question text
      if (input.startsWith("q:text:")) {
        const [, , targetIdStr, orderStr] = input.split(":");
        const targetId = parseInt(targetIdStr!);
        const orderIndex = parseInt(orderStr!);
        const q = await questionRepo.getQuestionByTargetAndOrder(targetId, orderIndex);
        if (q) await questionRepo.updateQuestion(q.question_id, { question_text: text });
        await ctx.reply("質問文を設定しました。", Markup.inlineKeyboard([[Markup.button.callback("戻る", `q:edit:${targetId}:${orderIndex}`)]]));
        return;
      }

      // Question options
      if (input.startsWith("q:options:")) {
        const [, , targetIdStr, orderStr] = input.split(":");
        const targetId = parseInt(targetIdStr!);
        const orderIndex = parseInt(orderStr!);
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) {
          await ctx.reply("少なくとも2行で選択肢を送信してください。");
          return;
        }
        const q = await questionRepo.getQuestionByTargetAndOrder(targetId, orderIndex);
        if (q) {
          await questionRepo.updateQuestion(q.question_id, {
            button1_label: lines[0] ?? "",
            button2_label: lines[1] ?? "",
            button3_label: lines[2] ?? "",
          });
        }
        await ctx.reply("選択肢を設定しました。", Markup.inlineKeyboard([[Markup.button.callback("戻る", `q:edit:${targetId}:${orderIndex}`)]]));
        return;
      }

      // Question next label
      if (input.startsWith("q:next:")) {
        const [, , targetIdStr, orderStr] = input.split(":");
        const targetId = parseInt(targetIdStr!);
        const orderIndex = parseInt(orderStr!);
        const q = await questionRepo.getQuestionByTargetAndOrder(targetId, orderIndex);
        if (q) await questionRepo.updateQuestion(q.question_id, { next_label: text });
        await ctx.reply("次へボタン文言を設定しました。", Markup.inlineKeyboard([[Markup.button.callback("戻る", `q:edit:${targetId}:${orderIndex}`)]]));
        return;
      }

      // Rule text
      if (input.startsWith("rule:text:")) {
        const targetId = parseInt(input.split(":")[2]!);
        const rule = await ruleRepo.getRuleByTarget(targetId);
        if (rule) await ruleRepo.upsertRule({ target_id: targetId, rule_text: text, accept_label: rule.accept_label, reject_label: rule.reject_label });
        await ctx.reply("ルール本文を設定しました。", Markup.inlineKeyboard([[Markup.button.callback("戻る", `target:rules:${targetId}`)]]));
        return;
      }

      if (input.startsWith("rule:accept:")) {
        const targetId = parseInt(input.split(":")[2]!);
        const rule = await ruleRepo.getRuleByTarget(targetId);
        if (rule) await ruleRepo.upsertRule({ target_id: targetId, rule_text: rule.rule_text, accept_label: text, reject_label: rule.reject_label });
        await ctx.reply("承諾ボタン文言を設定しました。", Markup.inlineKeyboard([[Markup.button.callback("戻る", `target:rules:${targetId}`)]]));
        return;
      }

      if (input.startsWith("rule:reject:")) {
        const targetId = parseInt(input.split(":")[2]!);
        const rule = await ruleRepo.getRuleByTarget(targetId);
        if (rule) await ruleRepo.upsertRule({ target_id: targetId, rule_text: rule.rule_text, accept_label: rule.accept_label, reject_label: text });
        await ctx.reply("拒否ボタン文言を設定しました。", Markup.inlineKeyboard([[Markup.button.callback("戻る", `target:rules:${targetId}`)]]));
        return;
      }

      // Topic create
      if (input.startsWith("topic:create:")) {
        const lgId = parseInt(input.split(":")[2]!);
        const lg = await logGroupRepo.getLogGroupById(lgId);
        if (!lg) { await ctx.reply("グループが見つかりません。"); return; }
        try {
          const result = await (ctx.telegram as any).createForumTopic(lg.chat_id, text);
          await logGroupRepo.createLogTopic({
            log_group_id: lgId,
            thread_id: result.message_thread_id,
            title: text,
          });
          await ctx.reply(`トピック「${text}」を作成しました。`, Markup.inlineKeyboard([[Markup.button.callback("戻る", `lg:topics:${lgId}`)]]));
        } catch (err: any) {
          await ctx.reply(`トピック作成に失敗しました: ${err.message}`, Markup.inlineKeyboard([[Markup.button.callback("戻る", `lg:topics:${lgId}`)]]));
        }
        return;
      }

      // Topic rename
      if (input.startsWith("topic:rename:")) {
        const parts = input.split(":");
        const lgId = parseInt(parts[2]!);
        const topicId = parseInt(parts[3]!);
        await logGroupRepo.updateLogTopic(topicId, { title: text });
        await ctx.reply(`トピック名を「${text}」に変更しました。`, Markup.inlineKeyboard([[Markup.button.callback("戻る", `lg:topics:${lgId}`)]]));
        return;
      }

      // Blacklist add
      if (input === "bl:add") {
        const targetUserId = parseInt(text);
        if (isNaN(targetUserId)) { await ctx.reply("有効なユーザーIDを送信してください。"); return; }
        await blacklistRepo.addToBlacklist({ user_id: targetUserId, status: "blocked", reason: "管理者により追加" });
        await ctx.reply(`ユーザーID ${targetUserId} をブラックリストに追加しました。`, Markup.inlineKeyboard([[Markup.button.callback("戻る", "menu:blacklist")]]));
        return;
      }

      // Blacklist remove
      if (input === "bl:remove") {
        const targetUserId = parseInt(text);
        if (isNaN(targetUserId)) { await ctx.reply("有効なユーザーIDを送信してください。"); return; }
        await blacklistRepo.removeFromBlacklist(targetUserId);
        await ctx.reply(`ユーザーID ${targetUserId} をブラックリストから削除しました。`, Markup.inlineKeyboard([[Markup.button.callback("戻る", "menu:blacklist")]]));
        return;
      }

      // Add admin
      if (input === "admin:add_id") {
        const newAdminId = parseInt(text);
        if (isNaN(newAdminId)) { await ctx.reply("有効なTelegram IDを送信してください。"); return; }
        await ownerRepo.addOwner(newAdminId);
        await ctx.reply(`✅ ユーザーID ${newAdminId} を管理者として追加しました。`, Markup.inlineKeyboard([[Markup.button.callback("戻る", "menu:admin_manage")]]));
        return;
      }

      await ctx.reply("入力を受け付けました。");
      return;
    }

    // ─── Default: show menu for admins ───
    const owner = await ownerRepo.getOwner(userId);
    if (owner) {
      const { topMenuKeyboard } = await import("./keyboards.js");
      await ctx.reply("管理メニュー", topMenuKeyboard());
    }
  });

  // Validate invite link on join - ensure 1-time use by authorized user only
  bot.on("chat_member", async (ctx) => {
    try {
      const update = ctx.update.my_chat_member;
      if (!update) return;
      const newStatus = update.new_chat_member.status;
      const oldStatus = update.old_chat_member.status;
      if (!["member", "restricted"].includes(newStatus) || oldStatus !== "left") return;
      
      const joiningUserId = update.new_chat_member.user.id;
      const chatId = update.chat.id;
      const inviteLink = update.invite_link?.invite_link;
      if (!inviteLink) return;

      const { validateAndUseInviteLink } = await import("../services/inviteService.js");
      const result = await validateAndUseInviteLink(ctx.telegram, inviteLink, joiningUserId, chatId);
      if (!result.valid) {
        try {
          await ctx.telegram.banChatMember(chatId, joiningUserId);
          await ctx.telegram.unbanChatMember(chatId, joiningUserId);
        } catch (err) {
          // ignore
        }
      } else {
        // User successfully joined - send GIF 2 and auto-delete after delay
        try {
          const { readFileSync } = await import("fs");
          const { join } = await import("path");
          const gif2Path = join(process.cwd(), "artifacts/bot/assets/approval2.gif");
          const gif2Buffer = readFileSync(gif2Path);
          
          const sentMsg = await (ctx.telegram as any).sendAnimation(joiningUserId, gif2Buffer, {
            caption: "🎉 グループへようこそ！\n\nあなたは参加が承認されました。",
          });

          // Auto-delete message after 10 seconds
          setTimeout(async () => {
            try {
              await ctx.telegram.deleteMessage(joiningUserId, sentMsg.message_id);
              console.log(`[INVITE] Auto-deleted welcome GIF for user ${joiningUserId}`);
            } catch (err) {
              console.warn(`[INVITE] Failed to auto-delete GIF: ${err}`);
            }
          }, 10000);
        } catch (err: any) {
          console.warn(`[INVITE] GIF 2 send failed: ${err.message}`);
        }
      }
    } catch (err: any) {
      console.error(`[CHAT_MEMBER] ${err.message}`);
    }
  });
}

// ─── Auto-promote bot as admin ───
async function tryPromoteAdmin(
  telegram: any,
  chatId: number,
  chatType: string
): Promise<{ success: boolean; message: string }> {
  try {
    const me = await telegram.getMe();
    const botId = me.id;

    if (chatType === "entry_group" || chatType === "log_group") {
      await telegram.promoteChatMember(chatId, botId, {
        is_anonymous: false,
        can_manage_chat: true,
        can_delete_messages: true,
        can_restrict_members: true,
        can_invite_users: true,
        can_pin_messages: chatType === "entry_group",
        can_manage_topics: chatType === "log_group",
      });
    } else if (chatType === "entry_channel") {
      await telegram.promoteChatMember(chatId, botId, {
        is_anonymous: false,
        can_manage_chat: true,
        can_post_messages: true,
        can_edit_messages: true,
        can_delete_messages: true,
        can_invite_users: true,
      });
    }

    return { success: true, message: "✅ Botを管理者として設定しました。" };
  } catch (err: any) {
    const reason = err?.description ?? err?.message ?? "不明なエラー";
    if (reason.includes("not a member") || reason.includes("USER_NOT_PARTICIPANT") || reason.includes("CHAT_ADMIN_REQUIRED")) {
      return {
        success: false,
        message: `⚠️ Botがまだグループに参加していないか、権限が不足しています。\n下のボタンからBotを追加してください。`,
      };
    }
    return {
      success: false,
      message: `⚠️ 管理者設定に失敗しました: ${reason}\nBotを手動でグループ管理者に追加してください。`,
    };
  }
}

// ─── Post-registration keyboard ───
function buildPostRegisterKeyboard(
  autoAdminSuccess: boolean,
  botUsername: string,
  chatId: number,
  isChannel: boolean,
  targetId: number | null,
  lgId: number | null
) {
  const buttons: any[][] = [];

  if (!autoAdminSuccess) {
    const addLink = isChannel
      ? `https://t.me/${botUsername}?startchannel=addadmin`
      : `https://t.me/${botUsername}?startgroup=addadmin`;
    buttons.push([Markup.button.url("🔧 Botをグループに追加して管理者設定", addLink)]);
  }

  if (targetId) {
    buttons.push([Markup.button.callback("詳細設定", `target:detail:${targetId}`)]);
  } else if (lgId) {
    buttons.push([Markup.button.callback("トピック管理", `lg:topics:${lgId}`)]);
  }

  buttons.push([Markup.button.callback("メインメニュー", "menu:top")]);

  return Markup.inlineKeyboard(buttons);
}
