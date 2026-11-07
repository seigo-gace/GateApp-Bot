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
import {recallOnlineGateDestination} from "../services/onlineGateRoutes.js";
import type { Target } from "../db/schema/targets.js";
import type { Context } from "telegraf";

function titleHeader(target: Target): string {
  return `【${target.title}】\n`;
}

async function deleteOldMessage(telegram: Telegram, userId: number, messageId: number | null | undefined): Promise<void> {
  if (!messageId) return;
  try {
    await telegram.deleteMessage(userId, messageId);
  } catch {}
}

async function sendMediaWithCaption(
  telegram: Telegram,
  userId: number,
  target: Target,
  caption: string,
  replyMarkup?: any
): Promise<number> {
  const { readFileSync, existsSync } = await import("fs");
  const { join } = await import("path");

  const mediaFileId = target.approval_media_file_id;
  const mediaType = target.approval_media_type;

  if (mediaFileId && mediaType) {
    try {
      const opts: any = { caption, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };
      let sent: any;
      if (mediaType === "video") {
        sent = await telegram.sendVideo(userId, mediaFileId, opts);
      } else if (mediaType === "animation") {
        sent = await telegram.sendAnimation(userId, mediaFileId, opts);
      } else if (mediaType === "photo") {
        sent = await telegram.sendPhoto(userId, mediaFileId, opts);
      } else {
        sent = await telegram.sendDocument(userId, mediaFileId, opts);
      }
      return sent.message_id;
    } catch (err: any) {
      console.warn(`[GATE] Custom media send failed: ${err.message}`);
    }
  }

  const defaultVideoPath = join(process.cwd(), "artifacts/bot/assets/default_gate.mp4");
  if (existsSync(defaultVideoPath)) {
    try {
      const videoBuffer = readFileSync(defaultVideoPath);
      const opts: any = { caption, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };
      const sent = await telegram.sendVideo(userId, { source: videoBuffer, filename: "gate.mp4" } as any, opts);
      return sent.message_id;
    } catch (err: any) {
      console.warn(`[GATE] Default video send failed: ${err.message}`);
    }
  }

  const opts: any = replyMarkup ? { reply_markup: replyMarkup } : {};
  const sent = await telegram.sendMessage(userId, caption, opts);
  return sent.message_id;
}

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
    challenge_data: null,
    last_message_id: null,
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
    challenge_data: session?.challenge_data ?? null,
    last_message_id: session?.last_message_id ?? null,
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

  const session = await sessionRepo.getGateSession(userId);
  await deleteOldMessage(telegram, userId, session?.last_message_id);

  if (step === "challenge" && challenge?.enabled) {
    const q = generateChallenge(challenge.difficulty);
    const buttons = q.options.map((opt, i) =>
      Markup.button.callback(opt, `gate:challenge:${i}`)
    );
    const sent = await telegram.sendMessage(
      userId,
      `${titleHeader(target)}本人確認のため、問題に答えてください。\n\n${q.text}`,
      Markup.inlineKeyboard([buttons])
    );
    await sessionRepo.upsertGateSession({
      tg_user_id: userId,
      target_id: target.target_id,
      step: "challenge",
      challenge_fails: session?.challenge_fails ?? 0,
      challenge_data: q as any,
      last_message_id: sent.message_id,
      last_attempt: session?.last_attempt ?? new Date(),
    });
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
    const sent = await telegram.sendMessage(userId, `${titleHeader(target)}${q.question_text}`, Markup.inlineKeyboard([btns]));
    await sessionRepo.upsertGateSession({
      tg_user_id: userId,
      target_id: target.target_id,
      step,
      challenge_fails: session?.challenge_fails ?? 0,
      challenge_data: session?.challenge_data ?? null,
      last_message_id: sent.message_id,
      last_attempt: session?.last_attempt ?? new Date(),
    });
    return;
  }

  if (step === "rules" && rule?.rule_text) {
    const sent = await telegram.sendMessage(
      userId,
      `${titleHeader(target)}${rule.rule_text}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(rule.accept_label || "同意する", "gate:rule:accept"),
          Markup.button.callback(rule.reject_label || "同意しない", "gate:rule:reject"),
        ],
      ])
    );
    await sessionRepo.upsertGateSession({
      tg_user_id: userId,
      target_id: target.target_id,
      step: "rules",
      challenge_fails: session?.challenge_fails ?? 0,
      challenge_data: session?.challenge_data ?? null,
      last_message_id: sent.message_id,
      last_attempt: session?.last_attempt ?? new Date(),
    });
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
    await telegram.sendMessage(userId, `${titleHeader(target)}テスト完了: 承認フローが正常に動作しています。`);
    await sessionRepo.deleteGateSession(userId);
    return;
  }

  const approval = await approvalRepo.getLatestApproval(target.target_id, userId);
  const displayName = approval?.display_name ?? String(userId);
  const username = approval?.username ?? undefined;
  const isPremium = approval?.is_premium ?? false;

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
      `${titleHeader(target)}招待リンクの生成に失敗しました。管理者にお問い合わせください。`
    );
    return;
  }

  if (approval) {
    await approvalRepo.updateApproval(approval.approval_id, {
      status: "approved",
      approved_at: new Date(),
    });
  }

  const caption = target.approval_caption
    ? `${titleHeader(target)}${target.approval_caption}`
    : `${titleHeader(target)}✨ 承認が完了しました！\n\n下のボタンから参加してください。`;

  // Preserve the originating ONLINE ROOM topic across question Gate flow.
  // The callback checks REAL membership before showing a Topic URL.
  const onlineRoute=await recallOnlineGateDestination(userId);
  const returnToOnline=onlineRoute?.targetId===target.target_id;
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🎉 参加する", url: inviteLink }],
      ...(returnToOnline?[[{text:"✅ 参加後にROOM掲示板へ",callback_data:"online:check"}]]:[]),
    ],
  };

  let approvalMsgId: number | null = null;
  try {
    approvalMsgId = await sendMediaWithCaption(telegram, userId, target, caption, replyMarkup);
  } catch (err: any) {
    console.warn(`[GATE] Media send failed, text fallback: ${err.message}`);
    const sent = await telegram.sendMessage(
      userId,
      caption,
      Markup.inlineKeyboard([[Markup.button.url("🎉 参加する", inviteLink)],...(returnToOnline?[[Markup.button.callback("✅ 参加後にROOM掲示板へ","online:check")]]:[])])
    );
    approvalMsgId = sent.message_id;
  }

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

  await sessionRepo.upsertGateSession({
    tg_user_id: userId,
    target_id: target.target_id,
    step: "approved",
    challenge_fails: 0,
    challenge_data: { pendingMessageIds: approvalMsgId ? [approvalMsgId] : [] } as any,
    last_message_id: approvalMsgId,
    last_attempt: new Date(),
  });
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
  bot.action(/^gate:challenge:(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    try { await ctx.answerCbQuery(); } catch {}

    try {
      const selectedIndex = parseInt((ctx.match as RegExpMatchArray)[1]!);
      const userId = ctx.from!.id;
      const session = await sessionRepo.getGateSession(userId);
      if (!session) {
        await ctx.reply("セッションが切れました。ゲートリンクからやり直してください。");
        return;
      }

      const target = await targetRepo.getTargetById(session.target_id);
      if (!target) return;

      const challenge = session.challenge_data as ChallengeQuestion | null;
      if (!challenge) {
        await ctx.reply("問題データが見つかりません。ゲートリンクからやり直してください。");
        return;
      }

      if (selectedIndex === challenge.correctIndex) {
        try { await ctx.deleteMessage(); } catch {}
        await sessionRepo.upsertGateSession({
          tg_user_id: userId,
          target_id: target.target_id,
          step: "challenge",
          challenge_fails: session.challenge_fails ?? 0,
          challenge_data: null,
          last_message_id: null,
          last_attempt: session.last_attempt ?? new Date(),
        });
        await stepNext(ctx.telegram, userId, target, "challenge", false);
      } else {
        const challengeCfg = await challengeRepo.getChallengeByTarget(target.target_id);
        const maxFail = challengeCfg?.max_fail ?? 3;
        const newFails = (session.challenge_fails ?? 0) + 1;

        if (newFails >= maxFail) {
          try { await ctx.deleteMessage(); } catch {}
          await ctx.telegram.sendMessage(userId, `${titleHeader(target)}本人確認に失敗しました。参加できません。`);
          await rejectUser(
            ctx.telegram, userId, target, "Bot判定失敗", "bot_failed",
            ctx.from!.username, ctx.from!.first_name, (ctx.from as any).is_premium
          );
        } else {
          const remaining = maxFail - newFails;
          const newQ = generateChallenge(challengeCfg?.difficulty ?? "standard");
          const buttons = newQ.options.map((opt, i) => Markup.button.callback(opt, `gate:challenge:${i}`));
          try {
            await ctx.editMessageText(
              `${titleHeader(target)}不正解です（残り${remaining}回）\n\n${newQ.text}`,
              Markup.inlineKeyboard([buttons])
            );
          } catch {}
          await sessionRepo.upsertGateSession({
            tg_user_id: userId,
            target_id: target.target_id,
            step: "challenge",
            challenge_fails: newFails,
            challenge_data: newQ as any,
            last_message_id: ctx.callbackQuery?.message?.message_id ?? null,
            last_attempt: session.last_attempt ?? new Date(),
          });
        }
      }
    } catch (err) {
      console.error("[GATE] challenge handler error:", err);
      try { await ctx.reply("エラーが発生しました。ゲートリンクからやり直してください。"); } catch {}
    }
  });

  bot.action(/^gate:q:(q[123]):([123])$/, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    try { await ctx.answerCbQuery(); } catch {}

    try {
      const step = (ctx.match as RegExpMatchArray)[1] as string;
      const buttonNum = parseInt((ctx.match as RegExpMatchArray)[2]!);
      const userId = ctx.from!.id;
      const session = await sessionRepo.getGateSession(userId);
      if (!session) {
        await ctx.reply("セッションが切れました。");
        return;
      }

      const target = await targetRepo.getTargetById(session.target_id);
      if (!target) return;

      const questions = (await questionRepo.getQuestionsByTarget(target.target_id)).filter((q) => q.enabled);
      const qIndex = step === "q1" ? 0 : step === "q2" ? 1 : 2;
      const q = questions[qIndex];
      if (!q) return;

      if (buttonNum === q.correct_button) {
        try { await ctx.deleteMessage(); } catch {}
        await sessionRepo.upsertGateSession({
          tg_user_id: userId,
          target_id: target.target_id,
          step,
          challenge_fails: session.challenge_fails ?? 0,
          challenge_data: null,
          last_message_id: null,
          last_attempt: session.last_attempt ?? new Date(),
        });
        await stepNext(ctx.telegram, userId, target, step, false);
      } else {
        try { await ctx.deleteMessage(); } catch {}
        await ctx.telegram.sendMessage(userId, `${titleHeader(target)}不正解のため参加できません。`);
        await rejectUser(
          ctx.telegram, userId, target, "質問失敗", "rejected",
          ctx.from!.username, ctx.from!.first_name, (ctx.from as any).is_premium
        );
      }
    } catch (err) {
      console.error("[GATE] question handler error:", err);
      try { await ctx.reply("エラーが発生しました。ゲートリンクからやり直してください。"); } catch {}
    }
  });

  bot.action("gate:rule:accept", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    try { await ctx.answerCbQuery(); } catch {}

    try {
      const userId = ctx.from!.id;
      const session = await sessionRepo.getGateSession(userId);
      if (!session) {
        await ctx.reply("セッションが切れました。");
        return;
      }
      const target = await targetRepo.getTargetById(session.target_id);
      if (!target) return;
      try { await ctx.deleteMessage(); } catch {}
      await sessionRepo.upsertGateSession({
        tg_user_id: userId,
        target_id: target.target_id,
        step: "rules",
        challenge_fails: session.challenge_fails ?? 0,
        challenge_data: null,
        last_message_id: null,
        last_attempt: session.last_attempt ?? new Date(),
      });
      await stepNext(ctx.telegram, userId, target, "rules", false);
    } catch (err) {
      console.error("[GATE] rule:accept handler error:", err);
      try { await ctx.reply("エラーが発生しました。ゲートリンクからやり直してください。"); } catch {}
    }
  });

  bot.action("gate:rule:reject", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    try { await ctx.answerCbQuery(); } catch {}

    try {
      const userId = ctx.from!.id;
      const session = await sessionRepo.getGateSession(userId);
      if (!session) {
        await ctx.reply("セッションが切れました。");
        return;
      }
      const target = await targetRepo.getTargetById(session.target_id);
      if (!target) return;
      try { await ctx.deleteMessage(); } catch {}
      await ctx.telegram.sendMessage(userId, `${titleHeader(target)}ルールに同意しなかったため参加できません。`);
      await rejectUser(
        ctx.telegram, userId, target, "ルール拒否", "rejected",
        ctx.from!.username, ctx.from!.first_name, (ctx.from as any).is_premium
      );
    } catch (err) {
      console.error("[GATE] rule:reject handler error:", err);
      try { await ctx.reply("エラーが発生しました。ゲートリンクからやり直してください。"); } catch {}
    }
  });
}
