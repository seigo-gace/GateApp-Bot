/** Runtime release-gate query for shared posting-menu registry. */
import {pool} from "../db/index.js";
export {
 POSTING_EDITOR_SPECS,POSTING_FEATURES,POSTING_PUBLIC_NAV_LABELS,
 POSTING_DM_CALLBACKS,POSTING_FEATURE_BY_LABEL,POSTING_CREATOR_URL,
 POSTING_TALK_URL,POSTING_BUG_REPORT_URL,
} from "./postingMenuContract.js";
import {POSTING_FEATURES} from "./postingMenuContract.js";
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
