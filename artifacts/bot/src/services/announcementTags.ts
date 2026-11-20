export const PURPOSE_TAGS = [
  'サシ','複数','見せ合い','野外/露出','掘りたい','掘られたい',
  '掘り合い','攻めたい','攻められたい','攻め合い','イチャイチャ',
  '飲み/飯','旅行'
] as const;
export const PLACE_TAGS = ['場所あり','場所なし','足あり'] as const;
export type AnnouncementTags = {
  purposeCodes: string[];
  placeCodes: string[];
  areaCode?: string;
};
export function validateAnnouncementTags(t: AnnouncementTags): void {
  if (new Set(t.purposeCodes).size !== t.purposeCodes.length ||
      t.purposeCodes.some(x => !PURPOSE_TAGS.includes(x as typeof PURPOSE_TAGS[number])))
    throw new Error('目的タグの内容を確認してください');
  if (new Set(t.placeCodes).size !== t.placeCodes.length ||
      t.placeCodes.some(x => !PLACE_TAGS.includes(x as typeof PLACE_TAGS[number])))
    throw new Error('場所/移動タグの内容を確認してください');
  // 採用済みの場所二者択一条件を検証。足ありは独立で併用可能。
  assertPlaceCodes(t.placeCodes);
}

export const PLACE_OPTIONS = ['場所あり', '場所なし'] as const;
export function normalizePlaceCodes(
  location: '場所あり' | '場所なし' | null,
  hasTransport: boolean
): string[] {
  return [...(location ? [location] : []), ...(hasTransport ? ['足あり'] : [])];
}
export function assertPlaceCodes(codes: string[]): void {
  if (new Set(codes).size !== codes.length ||
      codes.some(c => !['場所あり','場所なし','足あり'].includes(c)) ||
      (codes.includes('場所あり') && codes.includes('場所なし'))) {
    throw new Error('場所・移動条件の選択が正しくありません');
  }
}
