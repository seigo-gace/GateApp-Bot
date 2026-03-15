import { Telegraf, Markup, Telegram } from "telegraf";
import * as targetRepo from "../repositories/targetRepo.js";
import * as challengeRepo from "../repositories/challengeRepo.js";
import * as questionRepo from "../repositories/questionRepo.js";
import * as ruleRepo from "../repositories/ruleRepo.js";
import * as approvalRepo from "../repositories/approvalRepo.js";
import * as sessionRepo from "../repositories/sessionRepo.js";
import * as blacklistRepo from "../repositories/blacklistRepo.js";
import * as inviteRepo from "../repositories/inviteRepo.js";
import { generateChallenge, ChallengeQuestion } from "../services/challengeService.js";
import { sendLog } from "../services/loggingService.js";
import { createInviteLink } from "../services/inviteService.js";
import { COOLDOWN_SECONDS } from "../config/env.js";
import type { Target } from "../db/schema/targets.js";
import type { Context } from "telegraf";

// In-memory challenge storage (per user)
const activeChallenges = new Map<number, ChallengeQuestion>();

export async function startGateFlow(
  telegram: Telegram,
  userId: number,
  targetId: number,
  isTest: boolean = false
): Promise<void> {
  const target = await targetRepo.getTargetById(targetId);
  if (!target) {
    await telegram.sendMessage(userId, "設定エラー: 対象が見つかりません。");
    return;
  }

  // Cooldown check (skip for test mode)
  if (!isTest) {
    const session = await sessionRepo.getGateSession(userId);
    if (session?.last_attempt) {
      const elapsed = (Date.now() - session.last_attempt.getTime()) / 1000;
      if (elapsed < COOLDOWN_SECONDS) {
        const remaining = Math.ceil(COOLDOWN_SECONDS - elapsed);
        await telegram.sendMessage(
          userId,
          `連続申請は制限されています。${remaining}秒後に再度お試しください。`
        );
        return;
      }
    }
  }

  await sessionRepo.upsertGateSession({
    tg_user_id: userId,
    target_id: targetId,
    step: "start",
    challenge_fails: 0,
    last_attempt: new Date(),
  });

  await stepNext(telegram, userId, target, "start", isTest);
}

export async function stepNext(
  telegram: Telegram,
  userId: number,
  target: Target,
  currentStep: string,
  isTest: boolean = false
): Promise<void> {
  const challenge = await challengeRepo.getChallengeByTarget(target.target_id);
  const questions = (await questionRepo.getQuestionsByTarget(target.target_id)).filter((q) => q.enabled);
  const rule = await ruleRepo.getRuleByTarget(target.target_id);

  const session = await sessionRepo.getGateSession(userId);

  let nextStep: string;

  switch (currentStep) {
    case "start":
      nextStep = challenge?.enabled ? "challenge" : questions.length > 0 ? "q1" : rule?.rule_text ? "rules" : "approve";
      break;
    case "challenge":
      nextStep = questions.length > 0 ? "q1" : rule?.rule_text ? "rules" : "approve";
      break;
    case "q1":
      nextStep = questions.length > 1 ? "q2" : rule?.rule_text ? "rules" : "approve";
      break;
    case "q2":
      nextStep = questions.length > 2 ? "q3" : rule?.rule_text ? "rules" : "approve";
      break;
    case "q3":
      nextStep = rule?.rule_text ? "rules" : "approve";
      break;
    case "rules":
      nextStep = "approve";
      break;
    default:
      nextStep = "approve";
  }

  await sessionRepo.upsertGateSession({
    tg_user_id: userId,
    target_id: target.target_id,
    step: nextStep,
    challenge_fails: session?.challenge_fails ?? 0,
    last_attempt: session?.last_attempt ?? new Date(),
  });

  await sendStep(telegram, userId, target, nextStep, isTest);
}

async function sendStep(
  telegram: Telegram,
  userId: number,
  target: Target,
  step: string,
  isTest: boolean
): Promise<void> {
  const challenge = await challengeRepo.getChallengeByTarget(target.target_id);
  const questions = (await questionRepo.getQuestionsByTarget(target.target_id)).filter((q) => q.enabled);
  const rule = await ruleRepo.getRuleByTarget(target.target_id);

  if (step === "challenge" && challenge?.enabled) {
    const q = generateChallenge(challenge.difficulty);
    activeChallenges.set(userId, q);

    const buttons = q.options.map((opt, i) =>
      Markup.button.callback(opt, `gate:challenge:${i}`)
    );
    await telegram.sendMessage(
      userId,
      `本人確認のため、問題に答えてください。\n\n${q.text}`,
      Markup.inlineKeyboard([buttons])
    );
    return;
  }

  if (step === "q1" || step === "q2" || step === "q3") {
    const qIndex = step === "q1" ? 0 : step === "q2" ? 1 : 2;
    const q = questions[qIndex];
    if (!q) {
      await stepNext(telegram, userId, target, step, isTest);
      return;
    }

    const btns = [
      q.button1_label && Markup.button.callback(q.button1_label, `gate:q:${step}:1`),
      q.button2_label && Markup.button.callback(q.button2_label, `gate:q:${step}:2`),
      q.button3_label && Markup.button.callback(q.button3_label, `gate:q:${step}:3`),
    ].filter(Boolean) as ReturnType<typeof Markup.button.callback>[];

    await telegram.sendMessage(userId, q.question_text, Markup.inlineKeyboard([btns]));
    return;
  }

  if (step === "rules" && rule?.rule_text) {
    await telegram.sendMessage(
      userId,
      rule.rule_text,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(rule.accept_label || "同意する", "gate:rule:accept"),
          Markup.button.callback(rule.reject_label || "同意しない", "gate:rule:reject"),
        ],
      ])
    );
    return;
  }

  if (step === "approve") {
    await approveUser(telegram, userId, target, isTest);
    return;
  }
}

async function approveUser(
  telegram: Telegram,
  userId: number,
  target: Target,
  isTest: boolean
): Promise<void> {
  if (isTest) {
    await telegram.sendMessage(userId, "テスト完了: 承認フローが正常に動作しています。");
    await sessionRepo.deleteGateSession(userId);
    return;
  }

  // Get user info from session/cache (we don't have ctx here, use approval record)
  const approval = await approvalRepo.getLatestApproval(target.target_id, userId);
  const displayName = approval?.display_name ?? String(userId);
  const username = approval?.username ?? undefined;
  const isPremium = approval?.is_premium ?? false;

  // Create invite link
  let inviteLink: string | null = null;
  try {
    const inv = await createInviteLink(
      { telegram } as unknown as Telegraf,
      target.target_id,
      target.chat_id,
      userId
    );
    inviteLink = inv.invite_link;
  } catch (err: any) {
    console.error(`[GATE] Failed to create invite link: ${err.message}`);
    await telegram.sendMessage(
      userId,
      "招待リンクの生成に失敗しました。管理者にお問い合わせください。"
    );
    return;
  }

  // Update approval
  if (approval) {
    await approvalRepo.updateApproval(approval.approval_id, {
      status: "approved",
      approved_at: new Date(),
    });
  }

  // Send approval GIF 1 with join button
  try {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const gifPath = join(process.cwd(), "artifacts/bot/assets/approval1.gif");
    const gifBuffer = readFileSync(gifPath);
    await (telegram as any).sendAnimation(userId, gifBuffer, {
      caption: "✨ 承認が完了しました！\n\n下のボタンから参加してください。",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎉 参加する", url: inviteLink }],
        ],
      },
    });
  } catch (err: any) {
    console.warn(`[GATE] GIF 1 send failed, using fallback: ${err.message}`);
    await telegram.sendMessage(
      userId,
      "✨ 承認が完了しました！🎉\n\n下のボタンから参加してください。",
      Markup.inlineKeyboard([
        [Markup.button.url("🎉 参加する", inviteLink)],
      ])
    );
  }

  // Send log
  await sendLog({ telegram } as unknown as Telegraf, {
    type: "approved",
    targetTitle: target.title,
    userId,
    displayName,
    username,
    isPremium,
    logChatId: target.log_chat_id ? Number(target.log_chat_id) : null,
    logThreadId: target.log_thread_id ? Number(target.log_thread_id) : null,
  });

  await sessionRepo.deleteGateSession(userId);
}

async function rejectUser(
  telegram: Telegram,
  userId: number,
  target: Target,
  reason: string,
  logType: "rejected" | "blacklisted" | "bot_failed",
  username?: string,
  displayName?: string,
  isPremium?: boolean
): Promise<void> {
  const approval = await approvalRepo.getLatestApproval(target.target_id, userId);
  if (approval) {
    await approvalRepo.updateApproval(approval.approval_id, {
      status: "rejected",
      rejected_reason: reason,
    });
  }

  await sendLog({ telegram } as unknown as Telegraf, {
    type: logType,
    targetTitle: target.title,
    userId,
    displayName: displayName ?? approval?.display_name ?? String(userId),
    username: username ?? approval?.username ?? undefined,
    isPremium: isPremium ?? approval?.is_premium ?? false,
    reason,
    logChatId: target.log_chat_id ? Number(target.log_chat_id) : null,
    logThreadId: target.log_thread_id ? Number(target.log_thread_id) : null,
  });

  await sessionRepo.deleteGateSession(userId);
}

export function registerGateHandlers(bot: Telegraf): void {
  // Challenge answer
  bot.action(/^gate:challenge:(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch (err) {
      // Ignore callback query timeout
    }
    const selectedIndex = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const userId = ctx.from!.id;
    const session = await sessionRepo.getGateSession(userId);
    if (!session) { await ctx.reply("セッションが切れました。ゲートリンクからやり直してください。"); return; }

    const target = await targetRepo.getTargetById(session.target_id);
    if (!target) return;

    const challenge = activeChallenges.get(userId);
    if (!challenge) {
      await ctx.reply("問題データが見つかりません。やり直してください。");
      return;
    }

    const isTest = false; // TODO: propagate test mode through session

    if (selectedIndex === challenge.correctIndex) {
      activeChallenges.delete(userId);
      try {
        await ctx.editMessageText("正解です！");
      } catch (err) {
        // Message may already be edited
      }
      await stepNext(ctx.telegram, userId, target, "challenge", isTest);
    } else {
      const challengeCfg = await challengeRepo.getChallengeByTarget(target.target_id);
      const maxFail = challengeCfg?.max_fail ?? 3;
      const newFails = (session.challenge_fails ?? 0) + 1;

      if (newFails >= maxFail) {
        activeChallenges.delete(userId);
        try {
          await ctx.editMessageText("本人確認に失敗しました。参加できません。");
        } catch (err) {
          // Message may already be edited
        }
        await rejectUser(
          ctx.telegram,
          userId,
          target,
          "Bot判定失敗",
          "bot_failed",
          ctx.from!.username,
          ctx.from!.first_name,
          (ctx.from as any).is_premium
        );
      } else {
        await sessionRepo.upsertGateSession({
          tg_user_id: userId,
          target_id: target.target_id,
          step: "challenge",
          challenge_fails: newFails,
          last_attempt: session.last_attempt ?? new Date(),
        });
        const remaining = maxFail - newFails;
        const newQ = generateChallenge(challengeCfg?.difficulty ?? "standard");
        activeChallenges.set(userId, newQ);
        const buttons = newQ.options.map((opt, i) => Markup.button.callback(opt, `gate:challenge:${i}`));
        try {
          await ctx.editMessageText(
            `不正解です（残り${remaining}回）\n\n${newQ.text}`,
            Markup.inlineKeyboard([buttons])
          );
        } catch (err) {
          // Message may already be edited
        }
      }
    }
  });

  // Question answer
  bot.action(/^gate:q:(q[123]):([123])$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch (err) {
      // Ignore callback query timeout
    }
    const step = (ctx.match as RegExpMatchArray)[1] as string;
    const buttonNum = parseInt((ctx.match as RegExpMatchArray)[2]!);
    const userId = ctx.from!.id;
    const session = await sessionRepo.getGateSession(userId);
    if (!session) { await ctx.reply("セッションが切れました。"); return; }

    const target = await targetRepo.getTargetById(session.target_id);
    if (!target) return;

    const questions = (await questionRepo.getQuestionsByTarget(target.target_id)).filter((q) => q.enabled);
    const qIndex = step === "q1" ? 0 : step === "q2" ? 1 : 2;
    const q = questions[qIndex];
    if (!q) return;

    if (buttonNum === q.correct_button) {
      try {
        await ctx.editMessageText(q.next_label || "次へ");
      } catch (err) {
        // Message may already be edited
      }
      await stepNext(ctx.telegram, userId, target, step, false);
    } else {
      try {
        await ctx.editMessageText("不正解のため参加できません。");
      } catch (err) {
        // Message may already be edited
      }
      await rejectUser(
        ctx.telegram,
        userId,
        target,
        "質問失敗",
        "rejected",
        ctx.from!.username,
        ctx.from!.first_name,
        (ctx.from as any).is_premium
      );
    }
  });

  // Rule accept/reject
  bot.action("gate:rule:accept", async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch (err: any) {
      // Ignore callback query timeout errors
    }
    const userId = ctx.from!.id;
    const session = await sessionRepo.getGateSession(userId);
    if (!session) { await ctx.reply("セッションが切れました。"); return; }
    const target = await targetRepo.getTargetById(session.target_id);
    if (!target) return;
    try {
      await ctx.editMessageText("同意しました。");
    } catch (err) {
      // Message may already be edited
    }
    await stepNext(ctx.telegram, userId, target, "rules", false);
  });

  bot.action("gate:rule:reject", async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch (err: any) {
      // Ignore callback query timeout errors
    }
    const userId = ctx.from!.id;
    const session = await sessionRepo.getGateSession(userId);
    if (!session) { await ctx.reply("セッションが切れました。"); return; }
    const target = await targetRepo.getTargetById(session.target_id);
    if (!target) return;
    try {
      await ctx.editMessageText("ルールに同意しなかったため参加できません。");
    } catch (err) {
      // Message may already be edited
    }
    await rejectUser(
      ctx.telegram,
      userId,
      target,
      "ルール拒否",
      "rejected",
      ctx.from!.username,
      ctx.from!.first_name,
      (ctx.from as any).is_premium
    );
  });
}
