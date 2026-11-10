/** One active Telegram DM text flow across Profile, Announcement, Link,
 * ROOM creation and ROOM host scheduling. No new DB or session ownership.
 * Stale drafts remain available for explicit resumption but never steal input.
 */
import {pool} from "../db/index.js";
export type DmTextOwner="profile"|"room"|"announcement"|"link"|"room_host"|"room_application";
export async function currentDmTextOwner(userId:number):Promise<DmTextOwner|null>{
 if(!Number.isSafeInteger(userId)||userId<=0)throw new Error("DM_USER_INVALID");
 const result=await pool.query(
  `SELECT module FROM (
     SELECT 'profile'::text AS module,updated_at,1 AS priority
       FROM profile_drafts WHERE owner_user_id=$1 AND step <> 'cancelled'
     UNION ALL
     SELECT module,updated_at,2 AS priority
       FROM public_post_drafts WHERE owner_user_id=$1
         AND step NOT IN ('cancelled','published','saved')
     UNION ALL
     SELECT 'room_application'::text AS module,created_at AS updated_at,4 AS priority
       FROM announcement_application_sessions
       WHERE applicant_user_id=$1 AND expires_at>NOW()
         AND draft_step='awaiting_text'
     UNION ALL
     SELECT 'room_host'::text AS module,updated_at,3 AS priority
       FROM room_host_sessions
       WHERE owner_user_id=$1 AND expires_at>NOW()
   ) candidates ORDER BY updated_at DESC,priority DESC LIMIT 1`,[userId]);
 return result.rows.length?result.rows[0].module as DmTextOwner:null;
}
