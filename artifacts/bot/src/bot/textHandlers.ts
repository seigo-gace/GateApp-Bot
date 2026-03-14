import { Telegraf, Markup } from "telegraf";
import * as sessionRepo from "../repositories/sessionRepo.js";
import * as targetRepo from "../repositories/targetRepo.js";
import * as questionRepo from "../repositories/questionRepo.js";
import * as ruleRepo from "../repositories/ruleRepo.js";
import * as logGroupRepo from "../repositories/logGroupRepo.js";
import * as blacklistRepo from "../repositories/blacklistRepo.js";
import * as ownerRepo from "../repositories/ownerRepo.js";
import { generateGateCode } from "../utils/gateCode.js";
import type { Context, Message } from "telegraf/types";

export function registerTextHandlers(bot: Telegraf): void {
  bot.on("message", async (ctx) => {
    const userId = ctx.from!.id;
    const adminSession = await sessionRepo.getAdminSession(userId);

    // Handle forwarded messages for group/channel/log group registration
    const msg = ctx.message as any;

    // Check if this is a forwarded message (for adding groups/channels/log groups)
    if (adminSession?.state === "awaiting_forward" && adminSession.awaiting_input) {
      const type = adminSession.awaiting_input as string;

      // Check for forward_origin (newer API) or forward_from_chat (older)
      const forwardChat =
        msg.forward_origin?.chat ??
        msg.forward_from_chat ??
        null;

      if (forwardChat) {
        const chatId = forwardChat.id as number;
        const title = forwardChat.title as string ?? "不明";

        // Verify type matches
        const chatType = forwardChat.type as string;
        if (type === "entry_channel" && chatType !== "channel") {
          await ctx.reply("チャンネルから転送してください。");
          return;
        }
        if (type === "entry_group" && chatType !== "group" && chatType !== "supergroup") {
          await ctx.reply("グループから転送してください。");
          return;
        }
        if (type === "log_group" && chatType !== "supergroup") {
          await ctx.reply("スーパーグループ（フォーラム対応グループ）から転送してください。");
          return;
        }

        const gateCode = generateGateCode();

        if (type === "log_group") {
          // Register as log group
          const lg = await logGroupRepo.createLogGroup({
            owner_user_id: userId,
            chat_id: chatId,
            title,
          });
          await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "top", awaiting_input: null, temp_data: null });
          await ctx.reply(
            `ロググループ「${title}」を登録しました。\n次にトピックを設定しましょう。`,
            Markup.inlineKeyboard([
              [Markup.button.callback("トピック管理", `lg:topics:${lg.log_group_id}`)],
              [Markup.button.callback("メインメニュー", "menu:top")],
            ])
          );
        } else {
          // Register as entry target
          const newTarget = await targetRepo.createTarget({
            owner_user_id: userId,
            target_type: type,
            chat_id: chatId,
            title,
            gate_code: gateCode,
          });
          // Create default challenge, questions, rule records
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

          await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "top", awaiting_input: null, temp_data: null });

          const me = await ctx.telegram.getMe();
          const gateLink = `https://t.me/${me.username}?start=gate_${gateCode}`;

          await ctx.reply(
            `「${title}」を登録しました。\nゲートリンク: ${gateLink}`,
            Markup.inlineKeyboard([
              [Markup.button.callback("詳細設定", `target:detail:${newTarget.target_id}`)],
              [Markup.button.callback("メインメニュー", "menu:top")],
            ])
          );
        }
        return;
      } else {
        await ctx.reply("グループ/チャンネルからのメッセージを転送してください。");
        return;
      }
    }

    // Handle awaiting text inputs
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

      await ctx.reply("入力を受け付けました。");
      return;
    }

    // Default: show menu for admins
    const owner = await ownerRepo.getOwner(userId);
    if (owner) {
      const { topMenuKeyboard } = await import("./keyboards.js");
      await ctx.reply("管理メニュー", topMenuKeyboard());
    }
  });

  // Handle new chat members (for kick on no username)
  bot.on("chat_member", async (ctx) => {
    // handled elsewhere
  });
}
