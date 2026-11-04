/** ROOM join URL is a protected DM capability.
 * A user may receive the URL only if they are the room owner or an
 * explicitly accepted applicant of a linked announcement.
 * Never add these URLs to public MPB cards or webhook logs.
 */
import {pool} from "../db/index.js";
export type AuthorizedRoom={id:number;title:string;joinUrl:string;status:string};
function positive(id:number):void{
 if(!Number.isSafeInteger(id)||id<=0)throw new Error("ROOM_ACCESS_ID_INVALID");
}
export async function getAuthorizedRoom(
 userId:number,roomId:number
):Promise<AuthorizedRoom|null>{
 positive(userId);positive(roomId);
 const r=await pool.query(
  `SELECT r.room_id,r.title,r.join_url,r.status
   FROM room_posts r
   WHERE r.room_id=$2 AND r.status IN ('ready','live')
   AND (
     r.owner_user_id=$1
     OR (r.join_visibility='public' AND EXISTS(
       SELECT 1 FROM announcement_posts public_notice
        WHERE public_notice.room_id=r.room_id
          AND public_notice.status IN ('published','filled')
          AND EXISTS (
           SELECT 1 FROM posting_deliveries d
           JOIN posting_topics topic ON topic.topic_id=d.posting_topic_id
           WHERE d.source_type='announcement'
             AND d.source_id=public_notice.announcement_id::text
             AND d.status='sent' AND d.telegram_message_id IS NOT NULL
             AND topic.enabled=TRUE AND topic.purpose='announcement'
          )
     ))
     OR EXISTS(
       SELECT 1 FROM announcement_posts a
         JOIN announcement_applications ap
           ON ap.announcement_id=a.announcement_id
        WHERE a.room_id=r.room_id AND a.status IN ('published','filled','closed')
          AND ap.applicant_user_id=$1 AND ap.status='accepted'
     )
   )`,[userId,roomId]);
 if(r.rows.length!==1)return null;
 return {id:Number(r.rows[0].room_id),title:String(r.rows[0].title),
  joinUrl:String(r.rows[0].join_url),status:String(r.rows[0].status)};
}
export async function listAuthorizedRooms(userId:number):Promise<
 Array<{id:number;title:string;status:string}>>{
 positive(userId);
 const r=await pool.query(
  `SELECT r.room_id,r.title,r.status FROM room_posts r
    WHERE r.status IN ('ready','live') AND (
      r.owner_user_id=$1
      OR (r.join_visibility='public' AND EXISTS(
        SELECT 1 FROM announcement_posts public_notice
         WHERE public_notice.room_id=r.room_id
           AND public_notice.status IN ('published','filled')
          AND EXISTS (
           SELECT 1 FROM posting_deliveries d
           JOIN posting_topics topic ON topic.topic_id=d.posting_topic_id
           WHERE d.source_type='announcement'
             AND d.source_id=public_notice.announcement_id::text
             AND d.status='sent' AND d.telegram_message_id IS NOT NULL
             AND topic.enabled=TRUE AND topic.purpose='announcement'
          )
      ))
      OR EXISTS (
       SELECT 1 FROM announcement_posts a
       JOIN announcement_applications ap ON ap.announcement_id=a.announcement_id
       WHERE a.room_id=r.room_id AND a.status IN ('published','filled','closed')
         AND ap.applicant_user_id=$1 AND ap.status='accepted'
      )
    ) ORDER BY r.updated_at DESC LIMIT 30`,[userId]);
 return r.rows.map(row=>({id:Number(row.room_id),title:String(row.title),
   status:String(row.status)}));
}
