import { Telegraf, Markup } from "telegraf";
import type { CallbackQuery, Update } from "telegraf/types";
import {
  topMenuKeyboard,
  addMenuKeyboard,
  listMenuKeyboard,
  targetDetailKeyboard,
  logGroupDetailKeyboard,
  challengeSettingsKeyboard,
  questionsMenuKeyboard,
  questionEditKeyboard,
  ruleEditKeyboard,
  gateLinkKeyboard,
  logDestKeyboard,
  addAdminKeyboard,
  topicManageKeyboard,
  previewKeyboard,
  blacklistMenuKeyboard,
} from "./keyboards.js";
import * as targetRepo from "../repositories/targetRepo.js";
import * as logGroupRepo from "../repositories/logGroupRepo.js";
import * as challengeRepo from "../repositories/challengeRepo.js";
import * as questionRepo from "../repositories/questionRepo.js";
import * as ruleRepo from "../repositories/ruleRepo.js";
import * as blacklistRepo from "../repositories/blacklistRepo.js";
import * as sessionRepo from "../repositories/sessionRepo.js";
import * as ownerRepo from "../repositories/ownerRepo.js";
import { generateGateCode } from "../utils/gateCode.js";
import type { Context } from "telegraf";

function displayTargetType(t: string): string {
  if (t === "entry_group") return "グループ";
  if (t === "entry_channel") return "チャンネル";
  if (t === "log_group") return "ログ用グループ";
  return t;
}

export function registerMenuHandlers(bot: Telegraf) {
  // ─── TOP MENU ───
  bot.action("menu:top", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText("管理メニュー", topMenuKeyboard());
  });

  // ─── ADD MENU ───
  bot.action("menu:add", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "追加する種別を選んでください。",
      addMenuKeyboard()
    );
  });

  // ─── LIST MENU ───
  bot.action("menu:list", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText("管理中の一覧", listMenuKeyboard());
  });

  // ─── ADD: entry_group / entry_channel / log_group ───
  bot.action(/^add:(entry_group|entry_channel|log_group)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const type = (ctx.match as RegExpMatchArray)[1] as string;
    const userId = ctx.from!.id;

    await sessionRepo.upsertAdminSession({
      tg_user_id: userId,
      state: "awaiting_forward",
      awaiting_input: type,
      temp_data: null,
    });

    const label = type === "entry_group"
      ? "参加用グループ"
      : type === "entry_channel"
      ? "参加用チャンネル"
      : "ログ用グループ";

    await ctx.editMessageText(
      `${label}を追加します。\n\nそのグループ/チャンネルからメッセージを転送してください。\n（グループ内のメッセージを長押しして「転送」→このBotのDMへ）`,
      Markup.inlineKeyboard([
        [Markup.button.callback("キャンセル", "menu:add")],
      ])
    );
  });

  // ─── LIST: entry ───
  bot.action("list:entry", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const list = await targetRepo.getEntryTargetsByUserId(userId);

    if (list.length === 0) {
      await ctx.editMessageText(
        "参加対象が登録されていません。",
        Markup.inlineKeyboard([[Markup.button.callback("戻る", "menu:list")]])
      );
      return;
    }

    const buttons = list.map((t) => [
      Markup.button.callback(
        `${t.title} [${displayTargetType(t.target_type)}]`,
        `target:detail:${t.target_id}`
      ),
    ]);
    buttons.push([Markup.button.callback("戻る", "menu:list")]);

    await ctx.editMessageText("参加対象一覧", Markup.inlineKeyboard(buttons));
  });

  // ─── LIST: log ───
  bot.action("list:log", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    const list = await logGroupRepo.getLogGroupsByOwner(userId);

    if (list.length === 0) {
      await ctx.editMessageText(
        "ロググループが登録されていません。",
        Markup.inlineKeyboard([[Markup.button.callback("戻る", "menu:list")]])
      );
      return;
    }

    const buttons = list.map((g) => [
      Markup.button.callback(g.title, `lg:detail:${g.log_group_id}`),
    ]);
    buttons.push([Markup.button.callback("戻る", "menu:list")]);
    await ctx.editMessageText("ロググループ一覧", Markup.inlineKeyboard(buttons));
  });

  // ─── TARGET: detail ───
  bot.action(/^target:detail:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    await showTargetDetail(ctx, targetId);
  });

  // ─── TARGET: info ───
  bot.action(/^target:info:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const target = await targetRepo.getTargetById(targetId);
    if (!target) { await ctx.answerCbQuery("対象が見つかりません"); return; }

    const challenge = await challengeRepo.getChallengeByTarget(targetId);
    const qs = await questionRepo.getQuestionsByTarget(targetId);
    const rule = await ruleRepo.getRuleByTarget(targetId);
    const enabledQs = qs.filter((q) => q.enabled).length;

    const text = [
      `📋 基本情報`,
      ``,
      `名前: ${target.title}`,
      `種別: ${displayTargetType(target.target_type)}`,
      `ゲートリンク: ${target.gate_code ? "発行済" : "未発行"}`,
      `Bot対策: ${challenge?.enabled ? "ON" : "OFF"}`,
      `質問数: ${enabledQs}問`,
      `ルール: ${rule?.rule_text ? "設定済" : "未設定"}`,
      `ログ保存先: ${target.log_chat_id ? "設定済" : "未設定"}`,
    ].join("\n");

    await ctx.editMessageText(
      text,
      Markup.inlineKeyboard([[Markup.button.callback("戻る", `target:detail:${targetId}`)]])
    );
  });

  // ─── TARGET: gate ───
  bot.action(/^target:gate:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    await ctx.editMessageText(
      "ゲートリンク管理",
      gateLinkKeyboard(targetId)
    );
  });

  bot.action(/^gate:view:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const target = await targetRepo.getTargetById(targetId);
    if (!target) return;
    const me = await ctx.telegram.getMe();
    const link = `https://t.me/${me.username}?start=gate_${target.gate_code}`;
    await ctx.editMessageText(
      `ゲートリンク:\n${link}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("戻る", `target:gate:${targetId}`)],
      ])
    );
  });

  bot.action(/^gate:regen:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const newCode = generateGateCode();
    await targetRepo.updateTarget(targetId, { gate_code: newCode });
    const me = await ctx.telegram.getMe();
    const link = `https://t.me/${me.username}?start=gate_${newCode}`;
    await ctx.editMessageText(
      `ゲートリンクを再生成しました:\n${link}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("戻る", `target:gate:${targetId}`)],
      ])
    );
  });

  // ─── TARGET: challenge ───
  bot.action(/^target:challenge:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    let challenge = await challengeRepo.getChallengeByTarget(targetId);
    if (!challenge) {
      challenge = await challengeRepo.upsertChallenge({
        target_id: targetId,
        enabled: true,
        difficulty: "standard",
        max_fail: 3,
      });
    }
    await ctx.editMessageText(
      `Bot対策設定`,
      challengeSettingsKeyboard(targetId, challenge.enabled, challenge.difficulty, challenge.max_fail)
    );
  });

  bot.action(/^challenge:toggle:(\d+):(on|off)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const val = (ctx.match as RegExpMatchArray)[2] === "on";
    await challengeRepo.upsertChallenge({ target_id: targetId, enabled: val, difficulty: "standard", max_fail: 3 });
    const challenge = await challengeRepo.getChallengeByTarget(targetId);
    await ctx.editMessageText(
      "Bot対策設定",
      challengeSettingsKeyboard(targetId, challenge!.enabled, challenge!.difficulty, challenge!.max_fail)
    );
  });

  bot.action(/^challenge:diff:(\d+):(easy|standard|hard)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const diff = (ctx.match as RegExpMatchArray)[2] as string;
    let c = await challengeRepo.getChallengeByTarget(targetId);
    if (!c) c = await challengeRepo.upsertChallenge({ target_id: targetId, enabled: true, difficulty: diff, max_fail: 3 });
    else await challengeRepo.upsertChallenge({ target_id: targetId, enabled: c.enabled, difficulty: diff, max_fail: c.max_fail });
    const updated = await challengeRepo.getChallengeByTarget(targetId);
    await ctx.editMessageText(
      "Bot対策設定",
      challengeSettingsKeyboard(targetId, updated!.enabled, updated!.difficulty, updated!.max_fail)
    );
  });

  bot.action(/^challenge:fail:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const maxFail = parseInt((ctx.match as RegExpMatchArray)[2]!);
    let c = await challengeRepo.getChallengeByTarget(targetId);
    if (!c) c = await challengeRepo.upsertChallenge({ target_id: targetId, enabled: true, difficulty: "standard", max_fail: maxFail });
    else await challengeRepo.upsertChallenge({ target_id: targetId, enabled: c.enabled, difficulty: c.difficulty, max_fail: maxFail });
    const updated = await challengeRepo.getChallengeByTarget(targetId);
    await ctx.editMessageText(
      "Bot対策設定",
      challengeSettingsKeyboard(targetId, updated!.enabled, updated!.difficulty, updated!.max_fail)
    );
  });

  // ─── TARGET: questions ───
  bot.action(/^target:questions:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    await ctx.editMessageText("参加質問", questionsMenuKeyboard(targetId));
  });

  bot.action(/^q:edit:(\d+):([123])$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const orderIndex = parseInt((ctx.match as RegExpMatchArray)[2]!);
    let q = await questionRepo.getQuestionByTargetAndOrder(targetId, orderIndex);
    if (!q) {
      q = await questionRepo.upsertQuestion({
        target_id: targetId,
        order_index: orderIndex,
        enabled: false,
        question_text: "",
        button1_label: "",
        button2_label: "",
        button3_label: "",
        correct_button: 1,
        next_label: "次へ",
      });
    }
    const statusText = q.enabled ? "使用中" : "未使用";
    const text = [
      `質問${orderIndex} [${statusText}]`,
      `質問文: ${q.question_text || "（未設定）"}`,
      `選択肢1: ${q.button1_label || "（未設定）"}`,
      `選択肢2: ${q.button2_label || "（未設定）"}`,
      `選択肢3: ${q.button3_label || "（未設定）"}`,
      `正解: ${q.correct_button}番`,
      `次へボタン: ${q.next_label}`,
    ].join("\n");
    await ctx.editMessageText(text, questionEditKeyboard(targetId, orderIndex, q.enabled));
  });

  bot.action(/^q:toggle:(\d+):([123]):(on|off)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const orderIndex = parseInt((ctx.match as RegExpMatchArray)[2]!);
    const val = (ctx.match as RegExpMatchArray)[3] === "on";
    await questionRepo.upsertQuestion({ target_id: targetId, order_index: orderIndex, enabled: val, question_text: "", button1_label: "", button2_label: "", button3_label: "", correct_button: 1, next_label: "次へ" });
    const q = await questionRepo.getQuestionByTargetAndOrder(targetId, orderIndex);
    const statusText = q!.enabled ? "使用中" : "未使用";
    const text = [`質問${orderIndex} [${statusText}]`, `質問文: ${q!.question_text || "（未設定）"}`, `選択肢1: ${q!.button1_label || "（未設定）"}`, `選択肢2: ${q!.button2_label || "（未設定）"}`, `選択肢3: ${q!.button3_label || "（未設定）"}`, `正解: ${q!.correct_button}番`, `次へボタン: ${q!.next_label}`].join("\n");
    await ctx.editMessageText(text, questionEditKeyboard(targetId, orderIndex, q!.enabled));
  });

  // Handle setting question text / options / correct / next
  bot.action(/^q:settext:(\d+):([123])$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const orderIndex = parseInt((ctx.match as RegExpMatchArray)[2]!);
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({
      tg_user_id: userId,
      state: "awaiting_text",
      awaiting_input: `q:text:${targetId}:${orderIndex}`,
      temp_data: null,
    });
    await ctx.editMessageText(
      `質問${orderIndex}の質問文を送信してください。`,
      Markup.inlineKeyboard([[Markup.button.callback("キャンセル", `q:edit:${targetId}:${orderIndex}`)]])
    );
  });

  bot.action(/^q:setoptions:(\d+):([123])$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const orderIndex = parseInt((ctx.match as RegExpMatchArray)[2]!);
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({
      tg_user_id: userId,
      state: "awaiting_text",
      awaiting_input: `q:options:${targetId}:${orderIndex}`,
      temp_data: null,
    });
    await ctx.editMessageText(
      `選択肢を3行で送信してください。\n例:\n選択肢A\n選択肢B\n選択肢C`,
      Markup.inlineKeyboard([[Markup.button.callback("キャンセル", `q:edit:${targetId}:${orderIndex}`)]])
    );
  });

  bot.action(/^q:setcorrect:(\d+):([123])$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const orderIndex = parseInt((ctx.match as RegExpMatchArray)[2]!);
    await ctx.editMessageText(
      `正解ボタンを選んでください。`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("1番", `q:correct:${targetId}:${orderIndex}:1`),
          Markup.button.callback("2番", `q:correct:${targetId}:${orderIndex}:2`),
          Markup.button.callback("3番", `q:correct:${targetId}:${orderIndex}:3`),
        ],
        [Markup.button.callback("キャンセル", `q:edit:${targetId}:${orderIndex}`)],
      ])
    );
  });

  bot.action(/^q:correct:(\d+):([123]):([123])$/, async (ctx) => {
    await ctx.answerCbQuery("正解を設定しました");
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const orderIndex = parseInt((ctx.match as RegExpMatchArray)[2]!);
    const correct = parseInt((ctx.match as RegExpMatchArray)[3]!);
    const q = await questionRepo.getQuestionByTargetAndOrder(targetId, orderIndex);
    if (q) await questionRepo.updateQuestion(q.question_id, { correct_button: correct });
    const updated = await questionRepo.getQuestionByTargetAndOrder(targetId, orderIndex);
    const statusText = updated!.enabled ? "使用中" : "未使用";
    const text = [`質問${orderIndex} [${statusText}]`, `質問文: ${updated!.question_text || "（未設定）"}`, `選択肢1: ${updated!.button1_label || "（未設定）"}`, `選択肢2: ${updated!.button2_label || "（未設定）"}`, `選択肢3: ${updated!.button3_label || "（未設定）"}`, `正解: ${updated!.correct_button}番`, `次へボタン: ${updated!.next_label}`].join("\n");
    await ctx.editMessageText(text, questionEditKeyboard(targetId, orderIndex, updated!.enabled));
  });

  bot.action(/^q:setnext:(\d+):([123])$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const orderIndex = parseInt((ctx.match as RegExpMatchArray)[2]!);
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({
      tg_user_id: userId,
      state: "awaiting_text",
      awaiting_input: `q:next:${targetId}:${orderIndex}`,
      temp_data: null,
    });
    await ctx.editMessageText(
      `次へボタンの文言を送信してください。`,
      Markup.inlineKeyboard([[Markup.button.callback("キャンセル", `q:edit:${targetId}:${orderIndex}`)]])
    );
  });

  // ─── TARGET: rules ───
  bot.action(/^target:rules:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    let rule = await ruleRepo.getRuleByTarget(targetId);
    if (!rule) rule = await ruleRepo.upsertRule({ target_id: targetId, rule_text: "", accept_label: "同意する", reject_label: "同意しない" });
    const text = [`ルール設定`, ``, `本文: ${rule.rule_text || "（未設定）"}`, `承諾ボタン: ${rule.accept_label}`, `拒否ボタン: ${rule.reject_label}`].join("\n");
    await ctx.editMessageText(text, ruleEditKeyboard(targetId));
  });

  bot.action(/^rule:settext:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "awaiting_text", awaiting_input: `rule:text:${targetId}`, temp_data: null });
    await ctx.editMessageText("ルール本文を送信してください。", Markup.inlineKeyboard([[Markup.button.callback("キャンセル", `target:rules:${targetId}`)]]));
  });

  bot.action(/^rule:setaccept:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "awaiting_text", awaiting_input: `rule:accept:${targetId}`, temp_data: null });
    await ctx.editMessageText("承諾ボタンの文言を送信してください。", Markup.inlineKeyboard([[Markup.button.callback("キャンセル", `target:rules:${targetId}`)]]));
  });

  bot.action(/^rule:setreject:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "awaiting_text", awaiting_input: `rule:reject:${targetId}`, temp_data: null });
    await ctx.editMessageText("拒否ボタンの文言を送信してください。", Markup.inlineKeyboard([[Markup.button.callback("キャンセル", `target:rules:${targetId}`)]]));
  });

  // ─── TARGET: preview ───
  bot.action(/^target:preview:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const challenge = await challengeRepo.getChallengeByTarget(targetId);
    const qs = await questionRepo.getQuestionsByTarget(targetId);
    const rule = await ruleRepo.getRuleByTarget(targetId);

    const lines: string[] = ["参加条件プレビュー", ""];
    lines.push(`Bot対策: ${challenge?.enabled ? "ON" : "OFF"}`);
    lines.push("");
    const enabledQs = qs.filter((q) => q.enabled);
    if (enabledQs.length > 0) {
      lines.push(`参加質問 (${enabledQs.length}問):`);
      enabledQs.forEach((q, i) => {
        lines.push(`  Q${i + 1}: ${q.question_text || "（未設定）"}`);
        lines.push(`  1: ${q.button1_label}  2: ${q.button2_label}  3: ${q.button3_label}`);
        lines.push(`  正解: ${q.correct_button}番`);
      });
    } else {
      lines.push("参加質問: なし");
    }
    lines.push("");
    lines.push(`ルール: ${rule?.rule_text ? rule.rule_text.slice(0, 100) + (rule.rule_text.length > 100 ? "…" : "") : "（未設定）"}`);
    if (rule) {
      lines.push(`承諾: ${rule.accept_label}  拒否: ${rule.reject_label}`);
    }

    await ctx.editMessageText(lines.join("\n"), previewKeyboard(targetId));
  });

  bot.action(/^preview:test:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const userId = ctx.from!.id;
    // Start gate flow in test mode for admin
    await sessionRepo.upsertGateSession({
      tg_user_id: userId,
      target_id: targetId,
      step: "start",
      challenge_fails: 0,
    });
    await ctx.editMessageText("テストモードでゲートフローを開始します。\nBotのDMを確認してください。");
    // Trigger gate flow
    const { startGateFlow } = await import("./gateHandlers.js");
    await startGateFlow(ctx.telegram, userId, targetId, true);
  });

  // ─── TARGET: logdest ───
  bot.action(/^target:logdest:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const target = await targetRepo.getTargetById(targetId);
    let logInfo = "未設定";
    if (target?.log_chat_id) {
      const lg = await logGroupRepo.getLogGroupByChatId(Number(target.log_chat_id));
      logInfo = lg ? lg.title : `ID: ${target.log_chat_id}`;
    }
    const threadInfo = target?.log_thread_id ? `スレッド: ${target.log_thread_id}` : "トピック: 未設定";
    await ctx.editMessageText(
      `ログ保存先\n\nログ用グループ: ${logInfo}\n${threadInfo}`,
      logDestKeyboard(targetId)
    );
  });

  bot.action(/^logdest:choosegroup:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const userId = ctx.from!.id;
    const groups = await logGroupRepo.getLogGroupsByOwner(userId);

    if (groups.length === 0) {
      await ctx.editMessageText(
        "ロググループが登録されていません。先にロググループを追加してください。",
        Markup.inlineKeyboard([[Markup.button.callback("戻る", `target:logdest:${targetId}`)]])
      );
      return;
    }

    const buttons = groups.map((g) => [
      Markup.button.callback(g.title, `logdest:setgroup:${targetId}:${g.log_group_id}`),
    ]);
    buttons.push([Markup.button.callback("戻る", `target:logdest:${targetId}`)]);
    await ctx.editMessageText("ログ用グループを選んでください。", Markup.inlineKeyboard(buttons));
  });

  bot.action(/^logdest:setgroup:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const logGroupId = parseInt((ctx.match as RegExpMatchArray)[2]!);
    const lg = await logGroupRepo.getLogGroupById(logGroupId);
    if (!lg) return;
    await targetRepo.updateTarget(targetId, { log_chat_id: lg.chat_id });
    await ctx.editMessageText(
      `ログ用グループを「${lg.title}」に設定しました。\n次にトピックを選んでください。`,
      logDestKeyboard(targetId)
    );
  });

  bot.action(/^logdest:choosetopic:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const target = await targetRepo.getTargetById(targetId);
    if (!target?.log_chat_id) {
      await ctx.answerCbQuery("先にログ用グループを設定してください", true);
      return;
    }
    const lg = await logGroupRepo.getLogGroupByChatId(Number(target.log_chat_id));
    if (!lg) return;
    const topics = await logGroupRepo.getTopicsByLogGroup(lg.log_group_id);

    if (topics.length === 0) {
      await ctx.editMessageText(
        "トピックがありません。ロググループ管理からトピックを作成してください。",
        Markup.inlineKeyboard([[Markup.button.callback("戻る", `target:logdest:${targetId}`)]])
      );
      return;
    }

    const buttons = topics.map((t) => [
      Markup.button.callback(t.title, `logdest:settopic:${targetId}:${t.thread_id}`),
    ]);
    buttons.push([Markup.button.callback("戻る", `target:logdest:${targetId}`)]);
    await ctx.editMessageText("トピックを選んでください。", Markup.inlineKeyboard(buttons));
  });

  bot.action(/^logdest:settopic:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const threadId = parseInt((ctx.match as RegExpMatchArray)[2]!);
    await targetRepo.updateTarget(targetId, { log_thread_id: threadId });
    await ctx.answerCbQuery("トピックを設定しました");
    await ctx.editMessageText("トピックを設定しました。", logDestKeyboard(targetId));
  });

  bot.action(/^logdest:confirm:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const target = await targetRepo.getTargetById(targetId);
    const lg = target?.log_chat_id
      ? await logGroupRepo.getLogGroupByChatId(Number(target.log_chat_id))
      : null;
    const text = [
      "ログ保存先の設定",
      `グループ: ${lg?.title ?? "未設定"}`,
      `スレッドID: ${target?.log_thread_id ?? "未設定"}`,
    ].join("\n");
    await ctx.editMessageText(text, logDestKeyboard(targetId));
  });

  // ─── TARGET: addadmin ───
  bot.action(/^target:addadmin:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    await ctx.editMessageText(
      "Botを管理者として追加するには、対象のグループまたはチャンネルの管理者設定からBotを追加してください。",
      addAdminKeyboard(targetId, "target")
    );
  });

  bot.action(/^addadmin:(group|channel):(target|lg):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "Telegramの管理者設定からBotのユーザーを検索し、管理者として追加してください。\n必要な権限: メンバーの招待・キック、メッセージ送信",
      Markup.inlineKeyboard([[Markup.button.callback("戻る", "menu:top")]])
    );
  });

  // ─── TARGET: delete ───
  bot.action(/^target:delete:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const target = await targetRepo.getTargetById(targetId);
    if (!target) return;
    await ctx.editMessageText(
      `「${target.title}」を削除しますか？\nこの操作は元に戻せません。`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("削除する", `target:deleteconfirm:${targetId}`),
          Markup.button.callback("キャンセル", `target:detail:${targetId}`),
        ],
      ])
    );
  });

  bot.action(/^target:deleteconfirm:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const targetId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    await targetRepo.deleteTarget(targetId);
    await ctx.editMessageText("削除しました。", Markup.inlineKeyboard([[Markup.button.callback("戻る", "list:entry")]]));
  });

  // ─── LOG GROUP: detail ───
  bot.action(/^lg:detail:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const lg = await logGroupRepo.getLogGroupById(lgId);
    if (!lg) { await ctx.editMessageText("見つかりません"); return; }
    await ctx.editMessageText(`${lg.title}\n（ロググループ）`, logGroupDetailKeyboard(lgId));
  });

  bot.action(/^lg:info:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const lg = await logGroupRepo.getLogGroupById(lgId);
    if (!lg) return;
    const topics = await logGroupRepo.getTopicsByLogGroup(lgId);
    await ctx.editMessageText(
      [`基本情報`, `名前: ${lg.title}`, `Chat ID: ${lg.chat_id}`, `トピック数: ${topics.length}`].join("\n"),
      Markup.inlineKeyboard([[Markup.button.callback("戻る", `lg:detail:${lgId}`)]])
    );
  });

  // ─── LOG GROUP: topics ───
  bot.action(/^lg:topics:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    await ctx.editMessageText("トピック管理", topicManageKeyboard(lgId));
  });

  bot.action(/^topic:list:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const topics = await logGroupRepo.getTopicsByLogGroup(lgId);
    if (topics.length === 0) {
      await ctx.editMessageText("トピックがありません。", Markup.inlineKeyboard([[Markup.button.callback("戻る", `lg:topics:${lgId}`)]]));
      return;
    }
    const lines = topics.map((t) => `• ${t.title} (ID: ${t.thread_id})`).join("\n");
    await ctx.editMessageText(`トピック一覧:\n${lines}`, Markup.inlineKeyboard([[Markup.button.callback("戻る", `lg:topics:${lgId}`)]]));
  });

  bot.action(/^topic:create:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "awaiting_text", awaiting_input: `topic:create:${lgId}`, log_group_id: lgId, temp_data: null });
    await ctx.editMessageText("新しいトピック名を送信してください。", Markup.inlineKeyboard([[Markup.button.callback("キャンセル", `lg:topics:${lgId}`)]]));
  });

  bot.action(/^topic:rename:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const topics = await logGroupRepo.getTopicsByLogGroup(lgId);
    if (topics.length === 0) {
      await ctx.editMessageText("トピックがありません。", Markup.inlineKeyboard([[Markup.button.callback("戻る", `lg:topics:${lgId}`)]]));
      return;
    }
    const buttons = topics.map((t) => [Markup.button.callback(t.title, `topic:renamepick:${lgId}:${t.log_topic_id}`)]);
    buttons.push([Markup.button.callback("戻る", `lg:topics:${lgId}`)]);
    await ctx.editMessageText("名前を変更するトピックを選んでください。", Markup.inlineKeyboard(buttons));
  });

  bot.action(/^topic:renamepick:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const topicId = parseInt((ctx.match as RegExpMatchArray)[2]!);
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "awaiting_text", awaiting_input: `topic:rename:${lgId}:${topicId}`, log_group_id: lgId, temp_data: null });
    await ctx.editMessageText("新しいトピック名を送信してください。", Markup.inlineKeyboard([[Markup.button.callback("キャンセル", `lg:topics:${lgId}`)]]));
  });

  // ─── LOG GROUP: targets used ───
  bot.action(/^lg:targets:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const lg = await logGroupRepo.getLogGroupById(lgId);
    if (!lg) return;
    const allTargets = await targetRepo.getAllEntryTargets();
    const using = allTargets.filter((t) => t.log_chat_id === lg.chat_id);
    const text = using.length > 0
      ? `使用中の対象:\n${using.map((t) => `• ${t.title}`).join("\n")}`
      : "このロググループを使用している対象はありません。";
    await ctx.editMessageText(text, Markup.inlineKeyboard([[Markup.button.callback("戻る", `lg:detail:${lgId}`)]]));
  });

  // ─── LOG GROUP: addadmin ───
  bot.action(/^lg:addadmin:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    await ctx.editMessageText(
      "Botをスーパーグループの管理者として追加してください。\n必要な権限: メッセージ送信、トピック管理",
      addAdminKeyboard(lgId, "lg")
    );
  });

  // ─── LOG GROUP: delete ───
  bot.action(/^lg:delete:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    const lg = await logGroupRepo.getLogGroupById(lgId);
    if (!lg) return;
    await ctx.editMessageText(
      `「${lg.title}」を削除しますか？`,
      Markup.inlineKeyboard([
        [Markup.button.callback("削除する", `lg:deleteconfirm:${lgId}`), Markup.button.callback("キャンセル", `lg:detail:${lgId}`)],
      ])
    );
  });

  bot.action(/^lg:deleteconfirm:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const lgId = parseInt((ctx.match as RegExpMatchArray)[1]!);
    await logGroupRepo.deleteLogGroup(lgId);
    await ctx.editMessageText("削除しました。", Markup.inlineKeyboard([[Markup.button.callback("戻る", "list:log")]]));
  });

  // ─── BLACKLIST ───
  bot.action("menu:blacklist", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText("ブラックリスト管理", blacklistMenuKeyboard());
  });

  bot.action("bl:list", async (ctx) => {
    await ctx.answerCbQuery();
    const list = await blacklistRepo.getAllBlacklist();
    if (list.length === 0) {
      await ctx.editMessageText("ブラックリストは空です。", Markup.inlineKeyboard([[Markup.button.callback("戻る", "menu:blacklist")]]));
      return;
    }
    const lines = list.map((b) => `• ${b.user_id} [${b.status}] ${b.reason ?? ""}`).join("\n");
    await ctx.editMessageText(`ブラックリスト:\n${lines}`, Markup.inlineKeyboard([[Markup.button.callback("戻る", "menu:blacklist")]]));
  });

  bot.action("bl:add", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "awaiting_text", awaiting_input: "bl:add", temp_data: null });
    await ctx.editMessageText("追加するユーザーIDを送信してください（数字のみ）。", Markup.inlineKeyboard([[Markup.button.callback("キャンセル", "menu:blacklist")]]));
  });

  bot.action("bl:remove", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    await sessionRepo.upsertAdminSession({ tg_user_id: userId, state: "awaiting_text", awaiting_input: "bl:remove", temp_data: null });
    await ctx.editMessageText("削除するユーザーIDを送信してください（数字のみ）。", Markup.inlineKeyboard([[Markup.button.callback("キャンセル", "menu:blacklist")]]));
  });
}

async function showTargetDetail(ctx: Context, targetId: number): Promise<void> {
  const target = await targetRepo.getTargetById(targetId);
  if (!target) {
    await ctx.editMessageText("対象が見つかりません。", Markup.inlineKeyboard([[Markup.button.callback("戻る", "list:entry")]]));
    return;
  }
  await ctx.editMessageText(
    `${target.title}\n（${target.target_type === "entry_group" ? "参加用グループ" : "参加用チャンネル"}）`,
    targetDetailKeyboard(targetId)
  );
}
