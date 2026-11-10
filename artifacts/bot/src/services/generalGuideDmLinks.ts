/** Mint menu-origin tokens for L0 DM buttons on combined 総合案内 topic boards. */
import { pool } from "../db/index.js";
import { newMenuToken, tokenHash } from "./menuOrigin.js";
import { loadGeneralGuideNavLinks } from "./generalGuideNavLinks.js";
import type { NavLink } from "./menuPanelRenderer.js";

const DM_FEATURES = [
  { label: "検索/フィルター", feature: "search" },
  { label: "使い方", feature: "help" },
] as const;

export type GeneralGuideDmBundle = {
  links: NavLink[];
  tokenHashes: string[];
  panelId: number;
};

export async function mintGeneralGuideDmLinks(
  chatId: number,
): Promise<GeneralGuideDmBundle> {
  const base = await loadGeneralGuideNavLinks(chatId);
  const panel = await pool.query(
    `SELECT panel_id FROM board_menu_panels
     WHERE chat_id=$1 AND panel_type='general_guide'
       AND state IN ('verified','published')`,
    [chatId],
  );
  if (panel.rows.length !== 1) throw new Error("GENERAL_GUIDE_PANEL_MISSING");
  const panelId = Number(panel.rows[0].panel_id);
  const links = base.map((link) => ({ ...link }));
  const tokenHashes: string[] = [];
  const features: string[] = [];
  for (const spec of DM_FEATURES) {
    const token = newMenuToken();
    const hash = tokenHash(token);
    tokenHashes.push(hash);
    features.push(spec.feature);
    const idx = links.findIndex((l) => l.label === spec.label);
    if (idx < 0) throw new Error("GUIDE_DM_LABEL_MISSING:" + spec.label);
    links[idx] = {
      label: spec.label,
      url: `https://t.me/GayBBS_bot?start=m_${token}`,
      verified: true,
    };
  }
  await pool.query(
    `INSERT INTO board_menu_entry_tokens(token_hash,panel_id,feature,expires_at,enabled)
     SELECT token_hash,$1,feature,NOW()+INTERVAL '365 days',TRUE
     FROM UNNEST($2::text[],$3::text[]) AS candidate(token_hash,feature)`,
    [panelId, tokenHashes, features],
  );
  return { links, tokenHashes, panelId };
}

export async function commitGeneralGuideDmTokens(
  panelId: number,
  tokenHashes: string[],
): Promise<void> {
  if (!tokenHashes.length) return;
  await pool.query(
    `UPDATE board_menu_entry_tokens SET enabled=FALSE
     WHERE panel_id=$1 AND enabled=TRUE AND NOT(token_hash=ANY($2::text[]))`,
    [panelId, tokenHashes],
  );
}

export async function rollbackGeneralGuideDmTokens(
  panelId: number,
  tokenHashes: string[],
): Promise<void> {
  if (!tokenHashes.length) return;
  await pool.query(
    `UPDATE board_menu_entry_tokens SET enabled=FALSE
     WHERE panel_id=$1 AND token_hash=ANY($2::text[])`,
    [panelId, tokenHashes],
  );
}
