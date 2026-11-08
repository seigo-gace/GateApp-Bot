const GROUPS = new Set([-1003847210571, -1002373696859, -1003770334893]);

export function guideMessageUrl(chatId: number, messageId: number): string {
  if (
    !GROUPS.has(chatId) ||
    !Number.isSafeInteger(messageId) ||
    messageId <= 0
  ) {
    throw new Error("GUIDE_LINK_UNVERIFIED");
  }
  return (
    "https://t.me/c/" + String(chatId).replace("-100", "") + "/" + messageId
  );
}
