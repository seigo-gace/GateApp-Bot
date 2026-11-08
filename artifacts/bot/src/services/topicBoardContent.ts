/** Approved topic-board copy and verified Telegram destination links.
 * L1 panels use URL inline_keyboard via renderAreaBlockBoard / packButtonRows.
 */
import {
  packButtonRows,
  renderApprovedLinks,
  renderAreaBlockBoard,
  type ButtonSpec,
  type NavLink,
} from "./menuPanelRenderer.js";

export type BoardName = "video" | "category" | "national";
export type BoardEntry = { label: string; description: string; url: string };
export type AreaBlock = {
  label: string;
  url: string;
  children: readonly { label: string; url?: string }[];
};
export type TopicBoardPanel = { text: string; rows: ButtonSpec[][] };

const c = (id: number, n: number) => `https://t.me/c/${id}/${n}`;
export const VIDEO = 2373696859;
export const GAY = 3770334893;
export const AREA = 3847210571;
export const AREA_CHAT_ID = -1003847210571;

export const VIDEO_TOPICS: readonly BoardEntry[] = [
  { label: "🆕運営からのお知らせ", description: "運営からのお知らせや大切な情報を確認する掲示板です。", url: c(VIDEO, 1) },
  { label: "👀ビデオチャット", description: "ビデオチャットで交流する仲間を探す専用掲示板です。", url: c(VIDEO, 1605) },
  { label: "アガる🔥画像🖼️/動画🎞", description: "画像・動画を投稿し、みんなで楽しむ掲示板です。", url: c(VIDEO, 1634) },
  { label: "🎬️みんなのハメ撮り投稿", description: "自作の撮影動画を投稿して紹介する専用掲示板です。", url: c(VIDEO, 1692) },
  { label: "💰️稼げる有料動画投稿", description: "自作動画を価格設定して出品する専用掲示板です。", url: c(VIDEO, 1695) },
  { label: "🎦China逆輸入ビデオ", description: "China逆輸入ビデオの紹介専用掲示板です。", url: c(VIDEO, 1696) },
  { label: "🪪みんなのプロフ", description: "プロフィールを見て、交流したい相手を探す掲示板です。", url: c(VIDEO, 1613) },
];
export const CATEGORY_TOPICS: readonly BoardEntry[] = [
  { label: "🆕運営からのお知らせ", description: "運営からのお知らせや大切な情報を確認する掲示板です。", url: c(GAY, 1) },
  { label: "👤サシ", description: "1対1で交流する相手を探す掲示板です。", url: c(GAY, 2) },
  { label: "👥複数", description: "複数人での交流や仲間を探す掲示板です。", url: c(GAY, 3) },
  { label: "見せ合い👀", description: "映像での見せ合いや交流の相手を探す掲示板です。", url: c(GAY, 4) },
  { label: "🎭趣味/嗜好/フェチ", description: "共通の趣味や好みの相手を探す掲示板です。", url: c(GAY, 14) },
  { label: "S⚔M", description: "S・Mの好みに合う相手を探す掲示板です。", url: c(GAY, 15) },
  { label: "アダルトおもちゃ", description: "アダルトグッズの紹介や情報交換をする掲示板です。", url: c(GAY, 25) },
  { label: "露出、野外", description: "露出・野外について趣味の合う相手を探す掲示板です。法令とグループルールを守って利用してください。", url: c(GAY, 41) },
  { label: "みんなのプロフ", description: "プロフィールから交流相手を探す掲示板です。", url: c(GAY, 210) },
];

export const AREA_BLOCKS: readonly AreaBlock[] = [
  { label: "北海道", url: c(AREA, 49), children: [{ label: "北海道", url: c(AREA, 49) }] },
  {
    label: "東北",
    url: c(AREA, 621),
    children: [
      { label: "青森", url: c(AREA, 50) },
      { label: "秋田", url: c(AREA, 51) },
      { label: "岩手", url: c(AREA, 52) },
      { label: "山形", url: c(AREA, 53) },
      { label: "宮城", url: c(AREA, 54) },
      { label: "福島", url: c(AREA, 55) },
    ],
  },
  {
    label: "甲信越",
    url: c(AREA, 990),
    children: [
      { label: "新潟", url: c(AREA, 56) },
      { label: "長野", url: c(AREA, 57) },
      { label: "山梨", url: c(AREA, 58) },
    ],
  },
  {
    label: "北陸",
    url: c(AREA, 991),
    children: [
      { label: "富山", url: c(AREA, 59) },
      { label: "石川", url: c(AREA, 60) },
      { label: "福井", url: c(AREA, 61) },
    ],
  },
  {
    label: "北関東",
    url: c(AREA, 992),
    children: [
      { label: "群馬", url: c(AREA, 62) },
      { label: "栃木", url: c(AREA, 63) },
      { label: "茨城", url: c(AREA, 64) },
    ],
  },
  {
    label: "東京",
    url: c(AREA, 993),
    children: [
      { label: "池袋", url: c(AREA, 65) },
      { label: "新宿", url: c(AREA, 66) },
      { label: "渋谷", url: c(AREA, 67) },
      { label: "品川", url: c(AREA, 68) },
      { label: "都心", url: c(AREA, 69) },
      { label: "区東部", url: c(AREA, 70) },
      { label: "都下", url: c(AREA, 71) },
    ],
  },
  {
    label: "南関東",
    url: c(AREA, 994),
    children: [
      { label: "千葉", url: c(AREA, 72) },
      { label: "埼玉", url: c(AREA, 73) },
      { label: "横須賀・湘南・小田原", url: c(AREA, 74) },
      { label: "横浜・川崎", url: c(AREA, 75) },
      { label: "町田・相模原・厚木", url: c(AREA, 76) },
    ],
  },
  {
    label: "東海",
    url: c(AREA, 995),
    children: [
      { label: "静岡", url: c(AREA, 77) },
      { label: "愛知", url: c(AREA, 78) },
      { label: "岐阜", url: c(AREA, 79) },
      { label: "三重", url: c(AREA, 80) },
    ],
  },
  { label: "関西", url: c(AREA, 996), children: [{ label: "滋賀", url: c(AREA, 81) }, { label: "京都", url: c(AREA, 82) }, { label: "大阪キタ", url: c(AREA, 83) }, { label: "大阪ミナミ", url: c(AREA, 84) }, { label: "兵庫", url: c(AREA, 85) }, { label: "奈良", url: c(AREA, 86) }, { label: "和歌山", url: c(AREA, 87) }] },
  { label: "中国", url: c(AREA, 997), children: [{ label: "鳥取", url: c(AREA, 88) }, { label: "島根", url: c(AREA, 89) }, { label: "岡山", url: c(AREA, 90) }, { label: "広島", url: c(AREA, 91) }, { label: "山口", url: c(AREA, 92) }] },
  { label: "四国", url: c(AREA, 998), children: [{ label: "徳島", url: c(AREA, 93) }, { label: "香川", url: c(AREA, 94) }, { label: "愛媛", url: c(AREA, 95) }, { label: "高知", url: c(AREA, 96) }] },
  { label: "九州", url: c(AREA, 999), children: [{ label: "福岡", url: c(AREA, 97) }, { label: "大分", url: c(AREA, 98) }, { label: "佐賀", url: c(AREA, 99) }, { label: "長崎", url: c(AREA, 100) }, { label: "熊本", url: c(AREA, 101) }, { label: "宮崎", url: c(AREA, 102) }, { label: "鹿児島", url: c(AREA, 103) }] },
  { label: "沖縄", url: c(AREA, 104), children: [{ label: "沖縄", url: c(AREA, 104) }] },
];

export const AREA_BLOCK_SEARCH_URL = "https://t.me/GayBBS_bot?start=search";
export const AREA_BLOCK_FREETALK_URL = "https://t.me/c/3847210571/116";

/** Master #6725069736: no verified t.me URL in repo/DB yet (do not fabricate). */
/** All child area URLs canonical in AREA_BLOCKS + deploy/area-child-url-canonical-probe-v1.json */
export const AREA_CHILD_URL_PENDING = [] as const;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ensureLink = (url: string, expected: number): void => {
  if (!new RegExp(`^https://t\\.me/c/${expected}/[1-9][0-9]*$`).test(url))
    throw new Error("BOARD_LINK_INVALID");
};

export function messageIdFromBoardUrl(url: string): number {
  const match = url.match(/\/(\d+)$/);
  if (!match) throw new Error("BOARD_URL_INVALID");
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("BOARD_URL_INVALID");
  return id;
}

export function blockBoardKey(label: string): string {
  if (!AREA_BLOCKS.some((b) => b.label === label)) throw new Error("AREA_BLOCK_UNKNOWN");
  return `block:${label}`;
}

export function resolveChildAreaUrl(
  blockLabel: string,
  childLabel: string,
  dbLinks: Readonly<Record<string, string>>,
): string | undefined {
  const block = AREA_BLOCKS.find((b) => b.label === blockLabel);
  if (!block) throw new Error("AREA_BLOCK_UNKNOWN");
  const child = block.children.find((c) => c.label === childLabel);
  if (!child) throw new Error("AREA_CHILD_UNKNOWN");
  const url = child.url ?? dbLinks[`${blockLabel}/${childLabel}`];
  if (!url) return undefined;
  ensureLink(url, AREA);
  return url;
}

/** Verified URLs only — safe for HTML 🔗 and inline buttons (no fabricated links). */
export function resolveBlockChildUrlsPartial(
  blockLabel: string,
  dbLinks: Readonly<Record<string, string>>,
): Record<string, string> {
  const block = AREA_BLOCKS.find((b) => b.label === blockLabel);
  if (!block) throw new Error("AREA_BLOCK_UNKNOWN");
  const resolved: Record<string, string> = {};
  for (const child of block.children) {
    const key = `${blockLabel}/${child.label}`;
    const url = resolveChildAreaUrl(blockLabel, child.label, dbLinks);
    if (url) resolved[key] = url;
  }
  return resolved;
}

export function resolveBlockChildUrls(
  blockLabel: string,
  dbLinks: Readonly<Record<string, string>>,
): Record<string, string> {
  const block = AREA_BLOCKS.find((b) => b.label === blockLabel);
  if (!block) throw new Error("AREA_BLOCK_UNKNOWN");
  const resolved = resolveBlockChildUrlsPartial(blockLabel, dbLinks);
  for (const child of block.children) {
    const key = `${blockLabel}/${child.label}`;
    if (!resolved[key]) throw new Error(`AREA_CHILD_LINK_UNVERIFIED:${key}`);
  }
  return resolved;
}

const htmlLink = (label: string, url: string) =>
  `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;

/** L1 index posts: description plus tappable HTML links (not L0 13-button menu). */
export function buildTopicBoardHtml(board: "video" | "category"): string {
  const entries = board === "video" ? VIDEO_TOPICS : CATEGORY_TOPICS;
  const group = board === "video" ? VIDEO : GAY;
  const title =
    board === "video"
      ? "🎥 ビデオChatの掲示板｜トピック案内"
      : "♂️ ゲイのための掲示板｜カテゴリーボード";
  const intro =
    board === "video"
      ? "動画・画像・ビデオチャット・作品の出品など、目的に合わせて掲示板を選んで交流しましょう。"
      : "趣味・好み・交流目的に合わせて、気になるカテゴリーから友達や仲間を探しましょう。";
  const body = entries.map((entry) => {
    ensureLink(entry.url, group);
    return `${htmlLink(entry.label, entry.url)}\n${escapeHtml(entry.description)}`;
  });
  const text = `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(intro)}\n\n${body.join("\n\n")}`;
  if (text.length > 4096) throw new Error("BOARD_TEXT_TOO_LONG");
  return text;
}

const SINGLE_AREA_BLOCK = new Set(["北海道", "沖縄"]);

export function buildNationalBoardHtml(
  dbLinks: Readonly<Record<string, string>> = {},
): string {
  const sections: string[] = [];
  for (const block of AREA_BLOCKS) {
    ensureLink(block.url, AREA);
    if (SINGLE_AREA_BLOCK.has(block.label)) {
      sections.push(htmlLink("📍 " + block.label, block.url));
      continue;
    }
    const childLinks = block.children.map((child) => {
      const url = resolveChildAreaUrl(block.label, child.label, dbLinks);
      return url ? htmlLink(child.label, url) : escapeHtml(child.label);
    });
    sections.push(
      `${htmlLink("📍 " + block.label, block.url)}\n${childLinks.join(" · ")}`,
    );
  }
  const text =
    `<b>🗾 全国エリアボード</b>\n\nお住まいの地域や旅先のエリアを選び、地域の掲示板へ移動できます。\n\n${sections.join("\n\n")}`;
  if (text.length > 4096) throw new Error("BOARD_TEXT_TOO_LONG");
  return text;
}

/** Master 2026-11-08: national message 1166 body + 13 inline buttons on one post. */
export function buildNationalCombinedPanel(
  dbLinks: Readonly<Record<string, string>>,
  navLinks: readonly NavLink[],
): TopicBoardPanel {
  return {
    text: buildNationalBoardHtml(dbLinks),
    rows: renderApprovedLinks("general_guide", navLinks),
  };
}

export function buildL1IndexDelivery(
  kind: "video" | "category",
): TopicBoardPanel {
  return { text: buildTopicBoardHtml(kind), rows: [] };
}

/** L0 総合案内13ボタン + L1カテゴリ/ビデオ案内本文を1投稿に統合（エリア全国板と同型）。 */
export function buildL1CombinedPanel(
  kind: "video" | "category",
  navLinks: readonly NavLink[],
): TopicBoardPanel {
  return {
    text: buildTopicBoardHtml(kind),
    rows: renderApprovedLinks("general_guide", navLinks),
  };
}

export function buildAreaBlockPanel(
  blockLabel: string,
  resolved: Readonly<Record<string, string>>,
  nav: { search: string; filter: string; chat: string; back: string },
): TopicBoardPanel {
  const block = AREA_BLOCKS.find((b) => b.label === blockLabel);
  if (!block) throw new Error("AREA_BLOCK_UNKNOWN");
  const areaLinks: NavLink[] = [];
  const pending: string[] = [];
  for (const child of block.children) {
    const url = resolved[`${blockLabel}/${child.label}`] ?? resolveChildAreaUrl(blockLabel, child.label, resolved);
    if (url) areaLinks.push({ label: child.label, url, verified: true });
    else pending.push(child.label);
  }
  if (areaLinks.length === 0) throw new Error("AREA_BLOCK_NO_VERIFIED_CHILDREN");
  const pendingNote =
    pending.length > 0 ? `\n（未公開リンク: ${pending.map(escapeHtml).join(" · ")}）` : "";
  return renderAreaBlockBoard({
    blockTitle: `📍 ${blockLabel}｜エリアボード`,
    description: "地域を選んで、各掲示板へ移動できます。" + pendingNote,
    areaLinks,
    searchLink: { label: "🔍 検索", url: nav.search, verified: true },
    filterLink: { label: "📋 フィルター", url: nav.filter, verified: true },
    chatLink: { label: "雑談", url: nav.chat, verified: true },
    backLink: { label: "↩ 全国へ戻る", url: nav.back, verified: true },
  });
}

export function renderTopicBoard(board: "video" | "category"): string {
  return buildTopicBoardHtml(board);
}
export function renderNationalBoard(
  dbLinks: Readonly<Record<string, string>> = {},
): string {
  return buildNationalBoardHtml(dbLinks);
}
export function renderAreaBlock(label: string, resolved: Readonly<Record<string, string>> = {}): string {
  return buildAreaBlockPanel(label, resolved, {
    search: AREA_BLOCK_SEARCH_URL,
    filter: AREA_BLOCK_SEARCH_URL,
    chat: AREA_BLOCK_FREETALK_URL,
    back: c(AREA, 1166),
  }).text;
}
