/** Source-backed historical user-visible links for the 13-button general guide.
 * The URLs were supplied in the existing Notion Topic ledger. They are NOT
 * Telegram API verification receipts; publication must independently verify
 * existing source and actual destination before enabling a button.
 */
export type GuideGroup="area_bbs"|"video_chat"|"gay_board";
export type GuideLinkLabel=
 "お知らせ"|"雑談"|"みんなのプロフ"|"全国ボード"|"カテゴリーボード"|
 "ビデオ/動画"|"検索/フィルター"|"使い方"|"リンク"|
 "規約"|"規則"|"ルール"|"ガイドライン";
export const GUIDE_LINK_CANDIDATES:Readonly<Record<GuideGroup,
 Readonly<Partial<Record<GuideLinkLabel,string>>>>> = {
 area_bbs:{"リンク":"https://t.me/c/3847210571/273"},
 video_chat:{
  "お知らせ":"https://t.me/c/2373696859/1",
  "雑談":"https://t.me/c/2373696859/4291",
  "みんなのプロフ":"https://t.me/c/2373696859/1613",
  "リンク":"https://t.me/c/2373696859/1724",
 },
 gay_board:{
  "お知らせ":"https://t.me/c/3770334893/1",
  "雑談":"https://t.me/c/3770334893/789",
  "みんなのプロフ":"https://t.me/c/3770334893/210",
  "リンク":"https://t.me/c/3770334893/18",
 },
};
/** These four published document types are already registered in
 * general_guide_documents. They are not the distinct "規則" destination.
 */
export const GUIDE_DOCUMENT_TYPES= {
 "規約":"terms",
 "ルール":"rules",
 "ガイドライン":"safety",
 "使い方":"howto",
} as const;
export const GUIDE_BOARD_KEYS= {
 "全国ボード":"national",
 "カテゴリーボード":"category",
 "ビデオ/動画":"video",
} as const;
export const GUIDE_PENDING_EXTERNAL=[
 "検索/フィルター","規則",
] as const;
/** No conversion from t.me/c/<chat>/<message> to Bot API thread IDs. */
