/** Master #6724834952: L0 menus are 13 verified URL buttons only (no legal Telegram doc IDs). */
import { pool } from "../db/index.js";
import { guideMessageUrl } from "./guideMessageUrl.js";
import {
  GUIDE_PAGES_URLS,
  GUIDE_BOT_DM_URLS,
  approvedLayoutRows,
  type NavLink,
} from "./menuPanelRenderer.js";

const AREA = -1003847210571;
const VIDEO = -1002373696859;
const GAY = -1003770334893;

/** Master readback 2026-11-09: gay 1063, video 4570 general-guide posts. */
const PEER_GENERAL_GUIDE_MESSAGE: Readonly<Record<number, number>> = {
  [GAY]: 1063,
  [VIDEO]: 4570,
};

const ROW1_LINK_KEYS = [
  ["news", "お知らせ"],
  ["freetalk", "雑談"],
  ["profile", "みんなのプロフ"],
  ["community", "リンク"],
] as const;

async function nationalAreaGuideUrl(): Promise<string> {
  const r = await pool.query(
    `SELECT message_id FROM topic_board_posts
     WHERE board_key='national' AND chat_id=$1
       AND state='published' AND message_id IS NOT NULL`,
    [AREA],
  );
  if (r.rows.length !== 1) throw new Error("NATIONAL_AREA_GUIDE_NOT_PUBLISHED");
  return guideMessageUrl(AREA, Number(r.rows[0].message_id));
}

async function peerGeneralGuideUrl(chatId: number): Promise<string> {
  const fixed = PEER_GENERAL_GUIDE_MESSAGE[chatId];
  if (fixed) return guideMessageUrl(chatId, fixed);
  const panel = await pool.query(
    `SELECT message_id FROM board_menu_panels
     WHERE chat_id=$1 AND panel_type='general_guide'
       AND state='published' AND message_id IS NOT NULL`,
    [chatId],
  );
  if (panel.rows.length === 1) {
    return guideMessageUrl(chatId, Number(panel.rows[0].message_id));
  }
  throw new Error("PEER_GENERAL_GUIDE_NOT_PUBLISHED:" + chatId);
}

export async function loadGeneralGuideNavLinks(chatId: number): Promise<NavLink[]> {
  const links: NavLink[] = [
    { label: "全国ボード", url: await nationalAreaGuideUrl(), verified: true },
    { label: "カテゴリーボード", url: await peerGeneralGuideUrl(GAY), verified: true },
    { label: "ビデオ/動画", url: await peerGeneralGuideUrl(VIDEO), verified: true },
  ];

  const rows = await pool.query(
    `SELECT link_key,label,destination_url FROM general_guide_links
     WHERE chat_id=$1 AND enabled=TRUE
       AND verified_by IS NOT NULL AND verified_at IS NOT NULL`,
    [chatId],
  );
  const byKey = new Map(rows.rows.map((r) => [String(r.link_key), r]));

  if (chatId === AREA) {
    links.push({ label: "お知らせ", url: "https://t.me/c/3847210571/1", verified: true });
    links.push({ label: "雑談", url: "https://t.me/c/3847210571/116", verified: true });
    const profile = byKey.get("profile");
    const profileUrl = profile ? String(profile.destination_url) : "";
    if (!profileUrl || profileUrl.includes("2373696859/1613")) {
      throw new Error("GUIDE_URL_UNVERIFIED:みんなのプロフ");
    }
    links.push({ label: "みんなのプロフ", url: profileUrl, verified: true });
    const community = byKey.get("community");
    if (!community || String(community.label) !== "リンク") {
      throw new Error("GUIDE_URL_UNVERIFIED:リンク");
    }
    links.push({ label: "リンク", url: String(community.destination_url), verified: true });
  } else {
    for (const [key, label] of ROW1_LINK_KEYS) {
      const found = byKey.get(key);
      if (!found || String(found.label) !== label) {
        throw new Error("GUIDE_URL_UNVERIFIED:" + label);
      }
      links.push({ label, url: String(found.destination_url), verified: true });
    }
  }

  for (const [label, url] of Object.entries(GUIDE_BOT_DM_URLS)) {
    links.push({ label, url, verified: true });
  }

  for (const [label, url] of Object.entries(GUIDE_PAGES_URLS)) {
    links.push({ label, url, verified: true });
  }

  const expected = approvedLayoutRows("general_guide").flat();
  if (expected.length !== 13 || expected.some((l) => !links.some((x) => x.label === l))) {
    throw new Error("GUIDE_NAV_LINKS_NOT_VERIFIED");
  }
  return links;
}
