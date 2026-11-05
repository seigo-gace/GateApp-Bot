/** One-time, explicit migration for old profiles.pr bodies into external durable storage.
 * Never run automatically during startup. Run only after durable mount and backup
 * are verified. A failed object write leaves legacy SQL text untouched.
 */
import {pool} from "../src/db/index.js";
import {storeProfilePr,readProfilePr} from "../src/services/profilePrStorage.js";

export async function migrateLegacyProfilePr(dryRun:boolean){
 if(!dryRun&&!process.env.PROFILE_PR_STORAGE_DIR)
  throw Error("PROFILE_PR_DURABLE_STORAGE_NOT_CONFIGURED");
 let migrated=0;
 let scanned=0;
 let cursor="0";
 for(;;){
  const page=await pool.query<{owner_user_id:string;pr:string;pr_ref:string|null}>(
   `SELECT owner_user_id::text,pr,pr_ref FROM profiles
      WHERE owner_user_id>$1 AND pr IS NOT NULL ORDER BY owner_user_id LIMIT 100`,[cursor]);
  if(!page.rows.length)break;
  for(const row of page.rows){
   cursor=row.owner_user_id;
   scanned++;
   if(dryRun)continue;
   const id=Number(row.owner_user_id);
   if(!Number.isSafeInteger(id))throw Error("PROFILE_OWNER_ID_PRECISION_UNSAFE");
   const ref=await storeProfilePr(id,row.pr);
   if(await readProfilePr(id,ref)!==row.pr)throw Error("PROFILE_PR_MIGRATION_READBACK_FAILED");
   const updated=await pool.query(
    `UPDATE profiles SET pr_ref=$1,pr=NULL,updated_at=NOW()
      WHERE owner_user_id=$2 AND pr=$3 AND (pr_ref IS NULL OR pr_ref=$1)
      RETURNING pr_ref,pr`,[ref,row.owner_user_id,row.pr]);
   if(updated.rowCount!==1||updated.rows[0]?.pr_ref!==ref||updated.rows[0]?.pr!==null)
    throw Error("PROFILE_PR_MIGRATION_CONFLICT");
   migrated++;
  }
 }
 process.stdout.write(JSON.stringify({mode:dryRun?"dry-run":"execute",scanned,migrated})+"\n");
}
if(process.argv[1]?.endsWith("migrateLegacyProfilePr.ts")){
 const flags=process.argv.slice(2);
 const valid=flags.length===1&&["--dry-run","--execute"].includes(flags[0]!);
 if(!valid){
  console.error("USE_EITHER_--dry-run_OR_--execute");
  process.exitCode=1;
  void pool.end();
 }else{
  void migrateLegacyProfilePr(flags[0]==="--dry-run")
    .catch(e=>{console.error("MIGRATION_FAILED",e instanceof Error?e.message:"UNKNOWN");process.exitCode=1;})
    .finally(()=>pool.end());
 }
}
