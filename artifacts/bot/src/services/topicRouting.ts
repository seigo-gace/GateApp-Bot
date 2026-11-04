/** TGtumbler's verified Telegram Topic routing boundary.
 * t.me/c/... last path segment is a message link, never a thread ID.
 * No default destination and no fallback to another group/topic.
 */
export const BOARD_KEYS = ["area_bbs", "video_chat", "gay_board"] as const;
export type BoardKey = typeof BOARD_KEYS[number];
export const POST_PURPOSES = ["profile", "room", "announcement", "link"] as const;
export type PostPurpose = typeof POST_PURPOSES[number];
export type VerifiedTopic = {
  id: number;
  board: BoardKey;
  purpose: PostPurpose;
  chatId: number;
  threadId: number;
  title: string;
  verifiedAt: Date;
  enabled: boolean;
};
export function assertVerifiedTopic(
  topic: VerifiedTopic | null | undefined,
  board: BoardKey,
  purpose: PostPurpose,
): VerifiedTopic {
  if (!topic || !topic.enabled || topic.board !== board || topic.purpose !== purpose ||
      !Number.isSafeInteger(topic.id) || topic.id <= 0 ||
      !Number.isSafeInteger(topic.chatId) || topic.chatId >= 0 ||
      !Number.isSafeInteger(topic.threadId) || topic.threadId <= 0 ||
      !topic.title.trim() || !(topic.verifiedAt instanceof Date) ||
      !Number.isFinite(topic.verifiedAt.getTime()) ||
      topic.verifiedAt.getTime() > Date.now()) {
    throw new Error("TOPIC_NOT_VERIFIED");
  }
  return topic;
}
export function resolvePostingTopics(
  available: readonly VerifiedTopic[],
  board: BoardKey,
  purpose: PostPurpose,
): VerifiedTopic[] {
  const selected = available.filter(t => t.board === board && t.purpose === purpose && t.enabled);
  if (!selected.length) throw new Error("TOPIC_NOT_VERIFIED");
  if (selected.some(t => !isVerified(t))) throw new Error("TOPIC_NOT_VERIFIED");
  const keys = new Set(selected.map(t => String(t.chatId) + ":" + String(t.threadId)));
  if (keys.size !== selected.length) throw new Error("DUPLICATE_TOPIC_ROUTE");
  // The author must explicitly choose a target before anything is sent.
  return selected;
}
function isVerified(t: VerifiedTopic): boolean {
  try { assertVerifiedTopic(t,t.board,t.purpose); return true; } catch { return false; }
}
