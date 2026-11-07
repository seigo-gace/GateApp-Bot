/** Area's BBS-only suppression of legacy Telegram input chrome.
 * Does not alter default/private scopes or other groups. */
import type {Telegram} from "telegraf";

export const AREA_BBS_CHAT_ID = -1003847210571;
const SHOWTIME_LEGACY_BOT_ID = 8086265383;

const AREA_COMMAND_SCOPES = [
  { type: "chat" as const, chat_id: AREA_BBS_CHAT_ID },
  { type: "chat_administrators" as const, chat_id: AREA_BBS_CHAT_ID },
];

export type AreaCommandSuppressionResult = {
  chatId: number;
  scopesCleared: string[];
  legacyBotId: number;
  legacyBotStatus: string;
  legacyBotRemoved: boolean;
};

export async function suppressAreaCommandMenu(
  telegram: Telegram,
): Promise<AreaCommandSuppressionResult> {
  const scopesCleared: string[] = [];
  for (const scope of AREA_COMMAND_SCOPES) {
    await telegram.deleteMyCommands({ scope, language_code: "" });
    await telegram.setMyCommands([], { scope, language_code: "" });
    scopesCleared.push(scope.type);
  }
  let legacyBotStatus = "unknown";
  let legacyBotRemoved = false;
  try {
    const member = await telegram.getChatMember(AREA_BBS_CHAT_ID, SHOWTIME_LEGACY_BOT_ID);
    legacyBotStatus = member.status;
    if (member.status === "member" || member.status === "restricted") {
      await telegram.banChatMember(AREA_BBS_CHAT_ID, SHOWTIME_LEGACY_BOT_ID, {
        revoke_messages: false,
      });
      await telegram.unbanChatMember(AREA_BBS_CHAT_ID, SHOWTIME_LEGACY_BOT_ID, {
        only_if_banned: true,
      });
      legacyBotRemoved = true;
      const after = await telegram.getChatMember(AREA_BBS_CHAT_ID, SHOWTIME_LEGACY_BOT_ID);
      legacyBotStatus = after.status;
    }
  } catch {
    legacyBotStatus = "lookup_failed";
  }
  return {
    chatId: AREA_BBS_CHAT_ID,
    scopesCleared,
    legacyBotId: SHOWTIME_LEGACY_BOT_ID,
    legacyBotStatus,
    legacyBotRemoved,
  };
}
