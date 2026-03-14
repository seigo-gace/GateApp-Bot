import { Telegraf } from "telegraf";
import { formatJST } from "../utils/datetime.js";

export interface LogEntry {
  type: "approved" | "rejected" | "blacklisted" | "kicked" | "bot_failed";
  targetTitle: string;
  userId: number;
  displayName: string;
  username?: string;
  isPremium?: boolean;
  reason?: string;
  logChatId?: number | null;
  logThreadId?: number | null;
}

export async function sendLog(bot: Telegraf, entry: LogEntry): Promise<void> {
  if (!entry.logChatId) {
    console.warn(`[LOG] No log chat configured for target: ${entry.targetTitle}`);
    return;
  }

  const now = formatJST(new Date());
  const username = entry.username ? `@${entry.username}` : "-";
  const premium = entry.isPremium ? "✓" : "-";

  let header = "";
  let extra = "";

  switch (entry.type) {
    case "approved":
      header = "承認";
      break;
    case "rejected":
      header = "非承認";
      extra = `\n❌ ${entry.reason ?? "不明"}`;
      break;
    case "blacklisted":
      header = "非承認";
      extra = `\n⛔ BL一致`;
      break;
    case "kicked":
      header = "キック";
      extra = `\n⚠ ${entry.reason ?? "Username未設定"}`;
      break;
    case "bot_failed":
      header = "非承認";
      extra = `\n🤖 Bot判定失敗`;
      break;
  }

  const text = `${header}\n\n🕒 ${now}\n📍 ${entry.targetTitle}\n🆔 ${entry.userId}\n👤 ${entry.displayName}\n🔗 ${username}\n⭐ ${premium}${extra}`;

  try {
    const options: Record<string, unknown> = {};
    if (entry.logThreadId) {
      options.message_thread_id = entry.logThreadId;
    }
    await (bot.telegram as any).sendMessage(entry.logChatId, text, options);
  } catch (err: any) {
    console.error(`[LOG] Failed to send log: ${err.message}`);
  }
}
