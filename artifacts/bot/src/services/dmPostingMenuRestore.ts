/** Restore the adopted DM posting menu (11 buttons) on the same Bot message — no URL hop, no extra copy. */
import type { Context } from "telegraf";
import { bareStartPostingExtra, defaultBareStartChatId } from "./dmBareStartPostingMenu.js";
import {POSTING_MENU_SCREEN_TEXT} from "./menuPanelRenderer.js";
import { currentMenuOrigin } from "./menuOriginRepository.js";
import { currentTopicDmEntry } from "./topicDmEntry.js";
import { showWizardScreen } from "./dmWizardScreen.js";

export const DM_POSTING_MENU_SCREEN_TEXT = POSTING_MENU_SCREEN_TEXT;

export async function editMessageToDmPostingMenu(
  ctx: Context,
  userId: number,
): Promise<void> {
  const topic = await currentTopicDmEntry(userId);
  const origin = await currentMenuOrigin(userId);
  const chatId = defaultBareStartChatId(topic?.chatId ?? origin?.chatId ?? null);
  const keyboard = await bareStartPostingExtra(chatId);
  const callback=ctx.callbackQuery;
  const previous=callback&&"message" in callback?callback.message?.message_id:undefined;
  await showWizardScreen(ctx.telegram,userId,previous,
   DM_POSTING_MENU_SCREEN_TEXT,keyboard);
}
