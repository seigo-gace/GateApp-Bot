// Adapted from Notion 02 adopted announcement routing code; caller must provide VERIFIED topic registry.
export type AnnouncementKind = 'notice' | 'preview' | 'recruitment';
export type AnnouncementDraft = {
  ownerUserId: number; kind: AnnouncementKind;
  groupId: number; sourceThreadId?: number;
  publishThreadId?: number; body: string;
  purposeCodes: string[]; eventAt?: string;
  deadlineAt?: string; capacity?: number;
  acceptApplications: boolean;
  linkedRoomId?: number;
};
export type TopicRule = {
  groupId: number;
  allowedNoticeThreads: number[];
  allowedRecruitThreads: number[];
  videoChatThreadId?: number;
};
export function resolvePublishThread(
  d: AnnouncementDraft, rule: TopicRule
): number {
  if (d.groupId !== rule.groupId) throw new Error('グループ不一致');
  if (d.linkedRoomId !== undefined) {
    if (rule.videoChatThreadId === undefined)
      throw new Error('ビデオChat投稿先が未確認');
    return rule.videoChatThreadId;
  }
  const allowed = d.kind === 'recruitment'
    ? rule.allowedRecruitThreads : rule.allowedNoticeThreads;
  const candidate = d.publishThreadId ?? d.sourceThreadId;
  if (candidate === undefined || !allowed.includes(candidate))
    throw new Error('投稿先のTopicを確認してください');
  return candidate;
}
export function validateForPublish(d: AnnouncementDraft): void {
  if (!d.body.trim()) throw new Error('投稿本文が必要です');
  if (d.kind === 'preview' && !d.eventAt)
    throw new Error('予告日時を入力してください');
  if (d.kind === 'notice' && d.acceptApplications)
    throw new Error('通常告知に応募受付を自動設定しません');
  if (d.kind === 'recruitment' && d.purposeCodes.length === 0)
    throw new Error('募集目的を選択してください');
  if (d.capacity !== undefined &&
      (!Number.isSafeInteger(d.capacity) || d.capacity < 1))
    throw new Error('募集人数を確認してください');
  if (d.eventAt && !Number.isFinite(Date.parse(d.eventAt)))
    throw new Error('開催日時を確認してください');
  if (d.deadlineAt && !Number.isFinite(Date.parse(d.deadlineAt)))
    throw new Error('締切日時を確認してください');
  if (d.eventAt && d.deadlineAt &&
      Date.parse(d.deadlineAt) > Date.parse(d.eventAt))
    throw new Error('締切は開催より前にしてください');
}
