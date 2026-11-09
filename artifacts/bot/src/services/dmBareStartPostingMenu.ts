/** DM /start fallback: full posting menu (APPROVED_POSTING_ROWS 3/2/2/3), not the old 3-button stub. */
import { Markup } from "telegraf";
import { APPROVED_POSTING_ROWS } from "./menuPanelRenderer.js";
import { BOARD_GROUP_CHAT_IDS } from "./topicRouting.js";

export const STATIC_URL_LABELS = new Set([
  "クリエーター有料ビデオ投稿",
  "雑談",
  "紹介/招待",
]);

const CALLBACK_BY_LABEL: Readonly<Record<string, string>> = {
  相手募集: "dm:recruit",
  "プロフ作成": "dm:profile",
  "募集+Room": "dm:room",
  "告知/予告": "dm:announcement",
  "🔗ボタン作成": "dm:link",
  "検索/フィルター": "dm:search",
  操作説明: "dm:help",
};

const FEATURE_BY_LABEL: Readonly<Record<string, string>> = {
  相手募集: "announcement",
  "プロフ作成": "profile",
  "募集+Room": "room",
  "告知/予告": "announcement",
  "🔗ボタン作成": "link",
  "検索/フィルター": "search",
  操作説明: "help",
};

const POSTING_DM_FEATURES = [
  "profile",
  "announcement",
  "room",
  "link",
  "search",
  "help",
] as const;

export const BARE_START_POSTING_TEXT =
  "📌 各掲示板の固定メニュー（総合案内・投稿メニュー）から利用を開始してください。\n" +
  "下の投稿メニュー（10ボタン）から機能を選べます。各掲示板の固定メニューから開くと投稿先の文脈が付きます。";

async function postingDmFeaturesReady(): Promise<ReadonlySet<string>> {
  const { pool } = await import("../db/index.js");
  const gates = await pool.query<{ feature: string }>(
    `SELECT feature FROM gaybbs_feature_release_gates
     WHERE feature = ANY($1::text[])
       AND enabled=TRUE AND length(source_commit)=40
       AND length(trim(ci_evidence))>0
       AND length(trim(gserver_runtime_evidence))>0
       AND length(trim(COALESCE(telegram_dm_e2e_evidence,telegram_e2e_evidence)))>0
       AND approved_by IS NOT NULL`,
    [POSTING_DM_FEATURES],
  );
  return new Set(gates.rows.map((x) => String(x.feature)));
}

async function loadPostingNavUrls(
  chatId: number,
): Promise<ReadonlyMap<string, string>> {
  const { pool } = await import("../db/index.js");
  const r = await pool.query<{ label: string; destination_url: string }>(
    `SELECT label,destination_url FROM board_posting_menu_links
     WHERE chat_id=$1 AND enabled=TRUE
       AND verified_by IS NOT NULL AND verified_at IS NOT NULL`,
    [chatId],
  );
  const map = new Map<string, string>();
  for (const row of r.rows) {
    map.set(String(row.label), String(row.destination_url));
  }
  return map;
}

export function defaultBareStartChatId(menuOriginChatId?: number | null): number {
  if (
    menuOriginChatId !== null &&
    menuOriginChatId !== undefined &&
    Object.values(BOARD_GROUP_CHAT_IDS).includes(menuOriginChatId)
  ) {
    return menuOriginChatId;
  }
  return BOARD_GROUP_CHAT_IDS.area_bbs;
}

/** Missing optional navigation URLs cannot block the caller's return to the menu. */
export function navigationButton(label: string, verifiedUrl?: string) {
  return verifiedUrl
    ? Markup.button.url(label, verifiedUrl)
    : Markup.button.callback(label, "dm:nav-unavailable");
}

/** Builds the authoritative 3/2/2/3 inline keyboard for bare /start in DM. */
export async function bareStartPostingExtra(chatId: number) {
  const [ready, urls] = await Promise.all([
    postingDmFeaturesReady(),
    loadPostingNavUrls(chatId),
  ]);
  const rows = APPROVED_POSTING_ROWS.map((row) =>
    row.map((label) => {
      if (STATIC_URL_LABELS.has(label)) {
        const url = urls.get(label);
        // An unavailable link must never prevent the rest of the posting menu
        // (including a cancel -> menu return) from being rendered.
        return navigationButton(label, url);
      }
      const data = CALLBACK_BY_LABEL[label];
      if (!data) throw new Error("POSTING_CALLBACK_LABEL_UNKNOWN:" + label);
      const feature = FEATURE_BY_LABEL[label];
      if (feature && !ready.has(feature)) {
        return Markup.button.callback(label, "dm:blocked:" + feature);
      }
      return Markup.button.callback(label, data);
    }),
  );
  return Markup.inlineKeyboard(rows);
}

/** @internal row layout check for tests */
export function bareStartPostingRowLabels(): string[][] {
  return APPROVED_POSTING_ROWS.map((row) => [...row]);
}
