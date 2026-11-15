/** The single routing/release contract for both DM and three published boards.
 * No presentation decisions live here. Row/style/text stay in menuPanelRenderer.
 */
import {pool} from "../db/index.js";
export const POSTING_EDITOR_SPECS=[
 {label:"相手募集",feature:"announcement",prefix:"r_"},
 {label:"募集+Room",feature:"room",prefix:"m_"},
 {label:"告知/予告",feature:"announcement",prefix:"m_"},
 {label:"プロフ作成",feature:"profile",prefix:"m_"},
 {label:"🔗ボタン作成",feature:"link",prefix:"m_"},
 {label:"検索/フィルター",feature:"search",prefix:"m_"},
 {label:"操作説明",feature:"help",prefix:"m_"},
] as const;
export const POSTING_FEATURES=["profile","announcement","room","link","search","help"] as const;
export const POSTING_PUBLIC_NAV_LABELS=["クリエーター有料ビデオ投稿","雑談","紹介/招待"] as const;
export const POSTING_DM_CALLBACKS:Readonly<Record<string,string>>={
 "相手募集":"dm:recruit","プロフ作成":"dm:profile",
 "募集+Room":"dm:room","告知/予告":"dm:announcement",
 "🔗ボタン作成":"dm:link","検索/フィルター":"dm:search",
 "操作説明":"dm:help","雑談":"dm:talk","紹介/招待":"dm:invite",
 "🐞 不具合を報告":"dm:bug:open",
};
export const POSTING_FEATURE_BY_LABEL:Readonly<Record<string,string>>=
 Object.fromEntries(POSTING_EDITOR_SPECS.map(({label,feature})=>[label,feature]));
export const POSTING_CREATOR_URL="https://t.me/CreateVdobot?start=creator";
export const POSTING_TALK_URL="https://t.me/GayBBS_bot?start=talk";
export const POSTING_BUG_REPORT_URL="https://t.me/GayBBS_bot?start=bugreport";
/** Existing release criteria: identical for public menus and DM fallback. */
export async function loadPostingFeatureReadiness():Promise<ReadonlySet<string>>{
 const gates=await pool.query<{feature:string}>(`
 SELECT feature FROM gaybbs_feature_release_gates
 WHERE feature = ANY($1::text[])
   AND enabled=TRUE AND length(source_commit)=40
   AND length(trim(ci_evidence))>0
   AND length(trim(gserver_runtime_evidence))>0
   AND length(trim(COALESCE(telegram_dm_e2e_evidence,telegram_e2e_evidence)))>0
   AND approved_by IS NOT NULL`,[[...POSTING_FEATURES]]);
 return new Set(gates.rows.map(x=>String(x.feature)));
}
