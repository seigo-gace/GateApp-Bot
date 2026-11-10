/** Restore the adopted DM posting menu (10 buttons) on the same Bot message — no URL hop, no extra copy. */
import type { Context } from "telegraf";
import { bareStartPostingExtra, defaultBareStartChatId } from "./dmBareStartPostingMenu.js";
import { currentMenuOrigin } from "./menuOriginRepository.js";
import { currentTopicDmEntry } from "./topicDmEntry.js";

export const DM_POSTING_MENU_SCREEN_TEXT =
  "📝 投稿メニュー\nボタンを選択してください。";

export async function editMessageToDmPostingMenu(
  ctx: Context,
  userId: number,
): Promise<void> {
  const topic = await currentTopicDmEntry(userId);
  const origin = await currentMenuOrigin(userId);
  const chatId = defaultBareStartChatId(topic?.chatId ?? origin?.chatId ?? null);
  const keyboard = await bareStartPostingExtra(chatId);
  await ctx.editMessageText(DM_POSTING_MENU_SCREEN_TEXT, keyboard);
}
