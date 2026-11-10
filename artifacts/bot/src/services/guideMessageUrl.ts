const GROUPS = new Set([-1003847210571, -1002373696859, -1003770334893]);

/** Forum topic entry URLs use the thread id as the public path segment. */
export function guideTopicUrl(chatId: number, messageThreadId: number): string {
  if (
    !GROUPS.has(chatId) ||
    !Number.isSafeInteger(messageThreadId) ||
    messageThreadId <= 0
  ) {
    throw new Error("GUIDE_LINK_UNVERIFIED");
  }
  return (
    "https://t.me/c/" +
    String(chatId).replace("-100", "") +
    "/" +
    messageThreadId
  );
}

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
