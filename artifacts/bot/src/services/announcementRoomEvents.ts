/** Announcement-owned projection of ROOM source events.
 * ROOM never updates Announcement tables; MPB receives only a durable
 * dispatch request. No Telegram API call is allowed inside this DB job.
 */
import {pool} from "../db/index.js";

export type RoomNoticeKind="scheduled"|"prepared"|"started"|"postponed"|"cancelled"|"finished"|"visibility_changed";
export function projectRoomNotice(kind:RoomNoticeKind):{
  close:boolean; finalStatus:"cancelled"|"finished"|null;
}{
 if(!["scheduled","prepared","started","postponed","cancelled","finished","visibility_changed"].includes(kind))
   throw new Error("ROOM_NOTICE_KIND_INVALID");
 return {close:kind==="cancelled"||kind==="finished",
  finalStatus:kind==="cancelled"?"cancelled":kind==="finished"?"finished":null};
}
export async function projectNextRoomEvent():Promise<{
 eventId:number; announcementIds:number[];
}|null>{
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const current=await client.query(
   `SELECT e.event_id,e.room_id,e.kind,e.payload
      FROM room_source_events e
     WHERE e.state='pending'
       AND EXISTS (SELECT 1 FROM announcement_posts a WHERE a.room_id=e.room_id)
     ORDER BY e.event_id LIMIT 1 FOR UPDATE OF e SKIP LOCKED`);
  if(current.rows.length===0){
   await client.query("COMMIT");
   return null;
  }
  const e=current.rows[0];
  const kind=e.kind as RoomNoticeKind;
  const projected=projectRoomNotice(kind);
  const notices=await client.query(
   `SELECT announcement_id,owner_user_id,status
      FROM announcement_posts
     WHERE room_id=$1 ORDER BY announcement_id FOR UPDATE`,[e.room_id]);
  const ids:number[]=[];
  for(const a of notices.rows){
   const id=Number(a.announcement_id);
   // Keep terminal announcements terminal: never resurrect closed postings.
   // A filled recruitment still represents an active ROOM and must
   // receive LIVE/end updates. Closed recruitment receives a final ROOM
   // terminal marker, but must not be reopened by an intermediate event.
   if(["cancelled","finished"].includes(a.status)||
      (a.status==="closed"&&!projected.close)){
     await client.query(
      `INSERT INTO announcement_room_dispatches
         (announcement_id,room_event_id,source_revision,state)
       VALUES($1,$2,1,'skipped')
       ON CONFLICT(announcement_id,room_event_id) DO NOTHING`,
      [id,e.event_id]);
     continue;
   }
   const updated=await client.query(
    `UPDATE announcement_posts SET
       status=COALESCE($2,status),
       accept_applications=CASE WHEN $3 THEN FALSE ELSE accept_applications END,
       event_at=CASE WHEN $4::timestamptz IS NOT NULL THEN $4::timestamptz ELSE event_at END,
       revision=revision+1,updated_at=NOW()
      WHERE announcement_id=$1 RETURNING revision`,
    [id,projected.finalStatus,projected.close,
     e.payload?.startAt||null]);
   const revision=Number(updated.rows[0].revision);
   await client.query(
    `INSERT INTO announcement_room_dispatches
       (announcement_id,room_event_id,source_revision)
     VALUES($1,$2,$3)
     ON CONFLICT(announcement_id,room_event_id) DO NOTHING`,
    [id,e.event_id,revision]);
   // Each actual Telegram message is tracked separately: editing one target
   // must never imply that other group Topics were updated.
   await client.query(
    `INSERT INTO room_status_message_edits(room_event_id,delivery_id)
     SELECT $1,d.delivery_id FROM posting_deliveries d
      WHERE d.source_type='announcement' AND d.source_id=$2
        AND d.status='sent' AND d.telegram_message_id IS NOT NULL
     ON CONFLICT(room_event_id,delivery_id) DO NOTHING`,
    [e.event_id,String(id)]);
   await client.query(
    `INSERT INTO announcement_notifications
       (announcement_id,recipient_user_id,event_key,payload)
     VALUES($1,$2,$3,$4::jsonb)
     ON CONFLICT(event_key) DO NOTHING`,
    [id,a.owner_user_id,"room-event:"+e.event_id+":owner:"+id,
     JSON.stringify({source:"room",kind,roomId:Number(e.room_id),
      announcementId:id,revision})]);
   if(projected.close){
     await client.query(
      `INSERT INTO announcement_notifications
        (announcement_id,recipient_user_id,event_key,payload)
       SELECT $1,applicant_user_id,$2||applicant_user_id,$3::jsonb
         FROM announcement_applications
        WHERE announcement_id=$1 AND status='accepted'
       ON CONFLICT(event_key) DO NOTHING`,
      [id,"room-event:"+e.event_id+":participant:",
       JSON.stringify({source:"room",kind,roomId:Number(e.room_id),
        announcementId:id})]);
   }
   ids.push(id);
  }
  await client.query(
   `UPDATE room_source_events SET state='applied',updated_at=NOW()
      WHERE event_id=$1 AND state='pending'`,[e.event_id]);
  await client.query("COMMIT");
  return {eventId:Number(e.event_id),announcementIds:ids};
 }catch(error){
  await client.query("ROLLBACK");
  throw error;
 }finally{client.release();}
}
