/** DM /start fallback: full posting menu (APPROVED_POSTING_ROWS 3/2/2/3/1), not the old 3-button stub. */
import { Markup } from "telegraf";
import { APPROVED_POSTING_ROWS, postingButtonStyle } from "./menuPanelRenderer.js";
import { BOARD_GROUP_CHAT_IDS } from "./topicRouting.js";
import {commonGateUrl,gateInviteCopyButton} from "./commonGateInvite.js";
import {POSTING_DM_CALLBACKS,POSTING_FEATURE_BY_LABEL,POSTING_CREATOR_URL,loadPostingFeatureReadiness} from "./postingMenuRoutes.js";

export const STATIC_URL_LABELS = new Set([
  "クリエーター投稿",
]);

export const BARE_START_POSTING_TEXT =
  "📌 各掲示板の固定メニュー（総合案内・投稿メニュー）から利用を開始してください。\n" +
  "下の投稿メニュー（11ボタン）から機能を選べます。各掲示板の固定メニューから開くと投稿先の文脈が付きます。";

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

/** Opening a private recruitment draft does not grant permission to publish it.
 * publishPost still enforces the announcement release gate before any Telegram post.
 */
export function canOpenPostingEditor(label: string, featureReady: boolean): boolean {
  return ["相手募集","プロフ作成","検索/フィルター","🔗ボタン作成"].includes(label) || featureReady;
}

/** Missing optional navigation URLs cannot block the caller's return to the menu. */
export function navigationButton(label: string, verifiedUrl?: string) {
  return verifiedUrl
    ? Markup.button.url(label, verifiedUrl)
    : Markup.button.callback(label, "dm:nav-unavailable");
}

/** Builds the authoritative 3/2/2/3/1 inline keyboard for bare /start in DM. */
export async function bareStartPostingExtra(_chatId: number) {
  const [ready, inviteUrl] = await Promise.all([
    loadPostingFeatureReadiness().catch(()=>new Set<string>()),
    commonGateUrl().catch(()=>null),
  ]);
  const rows = APPROVED_POSTING_ROWS.map((row) =>
    row.map((label) => {
      const colorize=<T extends object>(button:T):T & {style:"primary"|"success"|"danger"}=>
        ({...button,style:postingButtonStyle(label)});
      if(label==="紹介/招待")return colorize(inviteUrl
        ? gateInviteCopyButton(label,inviteUrl)
        : Markup.button.callback(label,"dm:nav-unavailable"));
      if (STATIC_URL_LABELS.has(label)) {
        const url = label==="クリエーター投稿"
          ? POSTING_CREATOR_URL : undefined;
        // An unavailable link must never prevent the rest of the posting menu
        // (including a cancel -> menu return) from being rendered.
        return colorize(navigationButton(label, url));
      }
      const data = POSTING_DM_CALLBACKS[label];
      if (!data) throw new Error("POSTING_CALLBACK_LABEL_UNKNOWN:" + label);
      const feature = POSTING_FEATURE_BY_LABEL[label];
      if (feature && !canOpenPostingEditor(label, ready.has(feature))) {
        return colorize(Markup.button.callback(label, "dm:blocked:" + feature));
      }
      return colorize(Markup.button.callback(label, data));
    }),
  );
  return Markup.inlineKeyboard(rows as unknown as Parameters<typeof Markup.inlineKeyboard>[0]);
}

/** @internal row layout check for tests */
export function bareStartPostingRowLabels(): string[][] {
  return APPROVED_POSTING_ROWS.map((row) => [...row]);
}
