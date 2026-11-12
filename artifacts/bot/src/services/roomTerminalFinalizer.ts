/** The final DB data disappears only after the historical Telegram post
 * displays the terminal mark in every destination. No Telegram delete API.
 */
import {pool} from "../db/index.js";
import {purgeRoomTerminal} from "./roomPurge.js";

export async function finalizeNextRoom():Promise<number|null>{
 if(process.env.GAYBBS_ROOM_TERMINAL_PURGE_ENABLED!=="enabled")
  throw new Error("ROOM_TERMINAL_PURGE_NOT_RELEASED");
 const ready=await pool.query(
  `SELECT r.room_id,r.owner_user_id,r.revision,r.status
    FROM room_posts r
   WHERE r.status IN ('finished','cancelled')
   AND EXISTS (
     SELECT 1 FROM room_source_events e
      WHERE e.room_id=r.room_id AND e.kind=r.status AND e.state='applied')
   AND NOT EXISTS (
     SELECT 1 FROM room_source_events e
      WHERE e.room_id=r.room_id AND e.state<>'applied')
   AND NOT EXISTS (
     SELECT 1 FROM room_status_message_edits q
      JOIN room_source_events e ON e.event_id=q.room_event_id
      WHERE e.room_id=r.room_id AND q.state<>'confirmed')
   AND NOT EXISTS (
     SELECT 1 FROM posting_deliveries d
       JOIN announcement_posts a ON a.announcement_id::text=d.source_id
      WHERE a.room_id=r.room_id AND d.source_type='announcement'
       AND d.status IN ('sending','needs_reconcile'))
   AND NOT EXISTS (
     SELECT 1 FROM posting_deliveries d
       JOIN announcement_posts a ON a.announcement_id::text=d.source_id
      WHERE a.room_id=r.room_id AND d.source_type='announcement'
       AND d.status='sent' AND NOT EXISTS(
        SELECT 1 FROM room_status_message_edits q
         JOIN room_source_events e ON e.event_id=q.room_event_id
        WHERE e.room_id=r.room_id AND e.kind=r.status
          AND q.delivery_id=d.delivery_id AND q.state='confirmed'))
   AND NOT EXISTS(
     SELECT 1 FROM announcement_notifications n
       JOIN announcement_posts a ON a.announcement_id=n.announcement_id
     WHERE a.room_id=r.room_id
       AND n.state IN ('pending','sending','needs_reconcile'))
   ORDER BY r.room_id LIMIT 1`);
 if(!ready.rows.length)return null;
 const row=ready.rows[0],id=Number(row.room_id);
 const status=row.status==="finished"?"finish":"cancel";
 await purgeRoomTerminal(Number(row.owner_user_id),id,Number(row.revision),status);
 return id;
}
