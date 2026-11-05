/** Disposable Announcement/Recruitment data: no history kept after terminal/expiry.
 * This routine ONLY purges standalone postings. ROOM-linked postings remain
 * owned by roomPurge so active meeting/application state cannot be severed.
 * No Telegram sends, edits or retry attempts from housekeeping.
 * Never erase a sent/ambiguous Telegram delivery receipt before remote
 * deletion is confirmed; otherwise cleanup loses the only message ID.
 */
import {pool} from "../db/index.js";

export function shouldPurgeAnnouncement(
 status:string,roomLinked:boolean,expiresAt:Date|null,now:Date
):boolean{
 if(roomLinked)return false;
 if(["closed","cancelled","finished"].includes(status))return true;
 return expiresAt instanceof Date&&Number.isFinite(expiresAt.getTime())&&
   expiresAt.getTime()<=now.getTime();
}

/** Claim one terminal record with row lock. One batch is bounded to avoid long locks. */
export async function purgeDisposableAnnouncements(limit=20):Promise<number>{
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)
  throw new Error("ANNOUNCEMENT_PURGE_LIMIT_INVALID");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const now=await client.query("SELECT NOW() AS current_time");
  const cutoff=now.rows[0].current_time as Date;
  const candidates=await client.query(
   `SELECT announcement_id,status,room_id,expires_at,created_at,
      event_at,deadline_at,scheduled_at,publish_at
      FROM announcement_posts a
     WHERE a.room_id IS NULL
       AND (a.status IN ('closed','cancelled','finished')
         OR (a.expires_at IS NOT NULL AND a.expires_at<=NOW()))
       AND NOT EXISTS (
         SELECT 1 FROM posting_deliveries d
         WHERE d.source_type='announcement'
           AND d.source_id=a.announcement_id::text
           AND d.status IN ('sent','sending','needs_reconcile')
       )
     ORDER BY announcement_id
     LIMIT $1 FOR UPDATE SKIP LOCKED`,[limit]);
  const ids=candidates.rows.filter(x=>
   shouldPurgeAnnouncement(String(x.status),x.room_id!==null,x.expires_at,cutoff)
  ).map(x=>Number(x.announcement_id));
  if(!ids.length){
   await client.query("COMMIT");
   return 0;
  }
  await client.query(
   `DELETE FROM announcement_application_sessions WHERE token_hash IN
     (SELECT token_hash FROM announcement_application_entries
       WHERE announcement_id=ANY($1::bigint[]))`,[ids]);
  await client.query(
   "DELETE FROM announcement_application_entries WHERE announcement_id=ANY($1::bigint[])",
   [ids]);
  await client.query(
   "DELETE FROM announcement_notifications WHERE announcement_id=ANY($1::bigint[])",
   [ids]);
  await client.query(
   "DELETE FROM announcement_applications WHERE announcement_id=ANY($1::bigint[])",
   [ids]);
  await client.query(
   "DELETE FROM announcement_room_dispatches WHERE announcement_id=ANY($1::bigint[])",
   [ids]);
  await client.query(
   `DELETE FROM posting_deliveries
      WHERE source_type='announcement' AND source_id=ANY($1::text[])`,
   [ids.map(String)]);
  // The source editor is only an input buffer. Remove completed drafts only;
  // active drafts must not be deleted because another announcement ends.
  await client.query(
   `DELETE FROM public_post_drafts WHERE module='announcement'
      AND step='published' AND owner_user_id IN
      (SELECT owner_user_id FROM announcement_posts
       WHERE announcement_id=ANY($1::bigint[]))`,[ids]);
  const deleted=await client.query(
   `DELETE FROM announcement_posts WHERE announcement_id=ANY($1::bigint[])
    AND room_id IS NULL RETURNING announcement_id`,[ids]);
  if(deleted.rows.length!==ids.length)
   throw new Error("ANNOUNCEMENT_PURGE_INCOMPLETE");
  await client.query("COMMIT");
  return deleted.rows.length;
 }catch(error){
  await client.query("ROLLBACK");throw error;
 }finally{client.release();}
}

/** Expired abandoned editor drafts are not kept forever. Active/saved
 * ROOM lifecycle records are never purged by this task.
 */
export async function purgeAbandonedDrafts(maxAgeDays=7):Promise<number>{
 if(!Number.isSafeInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>90)
  throw new Error("DRAFT_TTL_INVALID");
 const r=await pool.query(
  `DELETE FROM public_post_drafts
    WHERE module IN ('announcement','link','room')
      AND step NOT IN ('saved')
      AND updated_at<NOW()-($1::int * INTERVAL '1 day')
    RETURNING owner_user_id`,[maxAgeDays]);
 return r.rows.length;
}
