/** Read-only TGtumbler Bot identity and 3-board rights preflight.
 * Uses the same GroupBot token resolver as both entrypoints.
 * Must run only in an authorized Bot container with its own Telegram secret.
 */
import "dotenv/config";
import { readConfiguredBotToken } from "../src/config/botToken.js";

const BOARDS = {
  AREA_BBS: -1003847210571,
  VIDEO_CHAT: -1002373696859,
  GAY_BOARD: -1003770334893,
} as const;

type BotMe = { id: number; username?: string };
type Chat = { id: number; type: string };
type Member = { status: string; can_invite_users?: boolean };

async function readApi<T>(
  token: string, method: string, data: Record<string, string> = {},
): Promise<T> {
  // Never log this URL: the credential is embedded in the Telegram API URL.
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    body: new URLSearchParams(data),
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json() as { ok?: boolean; result?: T };
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error("TELEGRAM_API_REJECTED");
  }
  return payload.result;
}

async function main(): Promise<number> {
  console.log("========== GACE_RESULT_BEGIN ==========");
  console.log("PROJECT=TGtumbler");
  console.log("ACTION=GAYBBS_REAL_GROUP_PREFLIGHT_READ_ONLY");
  let status = "FAIL";
  let error = "TOKEN_OR_API_CHECK_FAILED";
  try {
    const token = readConfiguredBotToken();
    const me = await readApi<BotMe>(token, "getMe");
    if (me.username?.toLowerCase() !== "gaybbs_bot" || me.id === 8086265383) {
      throw new Error("BOT_IDENTITY_MISMATCH");
    }
    console.log("BOT_IDENTITY=PASS");
    let allReady = true;
    for (const [label, chatId] of Object.entries(BOARDS)) {
      let state = "NOT_ACCESSIBLE";
      try {
        const chat = await readApi<Chat>(token, "getChat", {chat_id: String(chatId)});
        if (chat.id !== chatId || chat.type !== "supergroup") {
          state = "CHAT_MISMATCH";
        } else {
          const member = await readApi<Member>(token, "getChatMember", {
            chat_id: String(chatId), user_id: String(me.id),
          });
          const isAdmin = member.status === "creator" || member.status === "administrator";
          const canApprove = member.status === "creator" || member.can_invite_users === true;
          state = isAdmin && canApprove ? "ADMIN_AND_INVITE" : "INSUFFICIENT_RIGHTS";
        }
      } catch {
        state = "NOT_ACCESSIBLE";
      }
      console.log(label + "=" + state);
      if (state !== "ADMIN_AND_INVITE") allReady = false;
    }
    console.log("GROUPS_READY=" + (allReady ? "YES" : "NO"));
    status = allReady ? "PASS" : "PARTIAL";
    error = allReady ? "NONE" : "GROUP_MEMBERSHIP_OR_RIGHTS_NOT_READY";
  } catch {
    // Never show exceptions: network exceptions can include the credential URL.
  }
  console.log("VERIFY=" + status);
  console.log("ERROR=" + error);
  console.log("EXIT_CODE=" + (status === "PASS" ? "0" : "1"));
  console.log("PROJECT_END=TGtumbler");
  console.log("========== GACE_RESULT_END ==========");
  return status === "PASS" ? 0 : 1;
}

void main().then(code => { process.exitCode = code; }).catch(() => {
  // main handles ordinary errors and always prints a closed envelope.
  process.exitCode = 1;
});
