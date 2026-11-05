import { Markup, Telegraf } from "telegraf";

/** One authoritative keyboard for all three TGtumbler groups. */
export const GENERAL_GUIDE_ROWS = [
  ["お知らせ", "フリートーク/雑談"],
  ["全国エリアボード", "カテゴリーボード"],
  ["ビデオチャット/動画", "検索/フィルター"],
  ["みんなのプロフ", "コミュニティリンク"],
  ["グループルール", "使い方"],
  ["安全ガイド", "利用規約"],
] as const;

export const POST_MENU_ROWS = [
  ["相手募集", "募集+Room", "告知/予告"],
  ["クリエーター有料ビデオ投稿"],
  ["🔗ボタン作成", "検索/フィルター"],
  ["雑談", "紹介/招待", "操作説明"],
] as const;

export const HELP_MENU_ROWS = [
  ["プロフ", "Room+募集", "告知/予告"],
  ["🔗ボタン作成", "検索/フィルター", "戻る"],
] as const;

export const HELP_TEXT = {
  intro: "投稿メニューの操作方法です。下のボタンで説明を切り替えます。",
  profile: "プロフは本人が保存・編集する共通プロフィールです。公開する場合は公開先と項目を確認します。",
  room: "Room+募集ではROOMと相手募集を組み合わせます。ROOMの定員は設けません。公開先を確認してください。",
  announcement: "告知/予告は本文を入力し、必要な日時・媒体を選んで投稿します。",
  link: "🔗ボタン作成では表示文字とリンク先を指定し、プレビューで確認します。",
  search: "検索/フィルターではキーワード・詳細条件・プロフィール検索を一つの入口から扱います。",
} as const;

type MenuButton = { text: string; callback_data: string };
export type MenuRows = MenuButton[][];

export function rowsToKeyboard(rows: readonly (readonly string[])[], prefix: string): MenuRows {
  return rows.map((row, rowIndex) => row.map((label, columnIndex) => ({
    text: label,
    callback_data: `${prefix}:${rowIndex}:${columnIndex}`,
  })));
}

export const generalGuideKeyboard = (): MenuRows => rowsToKeyboard(GENERAL_GUIDE_ROWS, "tg:guide");
export const postingKeyboard = (): MenuRows => rowsToKeyboard(POST_MENU_ROWS, "tg:post");
export const helpKeyboard = (): MenuRows => rowsToKeyboard(HELP_MENU_ROWS, "tg:help");

const HELP_BY_POSITION: Record<string, keyof typeof HELP_TEXT | "back"> = {
  "0:0": "profile", "0:1": "room", "0:2": "announcement",
  "1:0": "link", "1:1": "search", "1:2": "back",
};

/** Preview/guide only: does not publish, charge, or mutate a user's data. */
export function registerApprovedMenuHandlers(bot: Telegraf): void {
  bot.command("postmenu", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    await ctx.reply("📝 投稿メニュー", Markup.inlineKeyboard(postingKeyboard()));
  });
  bot.command("generalguide", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    await ctx.reply("🏠 総合案内", Markup.inlineKeyboard(generalGuideKeyboard()));
  });
  bot.action(/^tg:post:(\d+):(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCbQuery();
    const key = `${ctx.match[1]}:${ctx.match[2]}`;
    if (key === "3:2") {
      await ctx.editMessageText(`📖 ${HELP_TEXT.intro}`, Markup.inlineKeyboard(helpKeyboard()));
      return;
    }
    const label = POST_MENU_ROWS[Number(ctx.match[1])]?.[Number(ctx.match[2])];
    if (!label) return;
    await ctx.editMessageText(
      `${label}\n\nこの入口の業務処理は未接続です。公開・課金・募集作成は実行していません。`,
      Markup.inlineKeyboard([[Markup.button.callback("戻る", "tg:back:post")]]),
    );
  });
  bot.action(/^tg:help:(\d+):(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCbQuery();
    const selection = HELP_BY_POSITION[`${ctx.match[1]}:${ctx.match[2]}`];
    if (!selection) return;
    if (selection === "back") {
      await ctx.editMessageText("📝 投稿メニュー", Markup.inlineKeyboard(postingKeyboard()));
      return;
    }
    await ctx.editMessageText(`📖 ${HELP_TEXT[selection]}`, Markup.inlineKeyboard(helpKeyboard()));
  });
  bot.action("tg:back:post", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCbQuery();
    await ctx.editMessageText("📝 投稿メニュー", Markup.inlineKeyboard(postingKeyboard()));
  });
  bot.action(/^tg:guide:(\d+):(\d+)$/, async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCbQuery();
    const label = GENERAL_GUIDE_ROWS[Number(ctx.match[1])]?.[Number(ctx.match[2])];
    if (!label) return;
    await ctx.editMessageText(`${label}\n\n対象の実トピックURL・案内先との接続は未確認です。`,
      Markup.inlineKeyboard([[Markup.button.callback("戻る", "tg:back:guide")]]));
  });
  bot.action("tg:back:guide", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.answerCbQuery();
    await ctx.editMessageText("🏠 総合案内", Markup.inlineKeyboard(generalGuideKeyboard()));
  });
}
