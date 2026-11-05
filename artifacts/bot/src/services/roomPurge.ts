/** Master decision 2026-11-05: do not retain ended/cancelled meeting DB data.
 * Complete hard-delete in one transaction. A failed cleanup rolls back;
 * never report completion when private meeting material still exists.
 * No profile/global bot records or announcements unrelated to this ROOM change.
 */
import {pool} from "../db/index.js";
import type {PoolClient} from "pg";
export type RoomTerminalAction="finish"|"cancel";
export type RoomPurgeResult={roomId:number;status:"finished"|"cancelled";deletedAnnouncements:number};

function checkId(value:number):void{
 if(!Number.isSafeInteger(value)||value<=0)throw new Error("ROOM_PURGE_ID_INVALID");
}
export async function purgeRoomTerminal(
 ownerUserId:number,roomId:number,expectedRevision:number,action:RoomTerminalAction
):Promise<RoomPurgeResult>{
 [ownerUserId,roomId,expectedRevision].forEach(checkId);
 const client:PoolClient=await pool.connect();
 try{
  await client.query("BEGIN");
  const found=await client.query(
   `SELECT owner_user_id,status,revision FROM room_posts
    WHERE room_id=$1 AND owner_user_id=$2 FOR UPDATE`,
   [roomId,ownerUserId]);
  if(found.rows.length!==1)throw new Error("ROOM_NOT_OWNED_OR_ALREADY_PURGED");
  const room=found.rows[0];
  if(Number(room.revision)!==expectedRevision)throw new Error("ROOM_REVISION_STALE");
  // Preserve original posts: terminal state is committed first and all
  // Telegram in-place status edits must be acknowledged before any DB purge.
  if(room.status!==(action==="finish"?"finished":"cancelled"))
   throw new Error("ROOM_TERMINAL_STATE_NOT_DECLARED");
  const checks=await client.query(
   `SELECT
    EXISTS(SELECT 1 FROM room_source_events
      WHERE room_id=$1 AND kind=$2 AND state='applied') AS terminal_projected,
    EXISTS(SELECT 1 FROM room_source_events
      WHERE room_id=$1 AND state<>'applied') AS pending_events,
    EXISTS(SELECT 1 FROM room_status_message_edits q
      JOIN room_source_events e ON e.event_id=q.room_event_id
      WHERE e.room_id=$1 AND q.state<>'confirmed') AS unconfirmed_edits,
    EXISTS(SELECT 1 FROM posting_deliveries d
      JOIN announcement_posts a ON a.announcement_id::text=d.source_id
      WHERE a.room_id=$1 AND d.source_type='announcement'
      AND d.status IN ('sending','needs_reconcile')) AS unknown_deliveries,
    EXISTS(SELECT 1 FROM posting_deliveries d
      JOIN announcement_posts a ON a.announcement_id::text=d.source_id
      WHERE a.room_id=$1 AND d.source_type='announcement'
      AND d.status='sent' AND NOT EXISTS(
        SELECT 1 FROM room_status_message_edits q
        JOIN room_source_events e ON e.event_id=q.room_event_id
        WHERE e.room_id=$1 AND e.kind=$2
          AND q.delivery_id=d.delivery_id AND q.state='confirmed'
      )) AS unmarked_posts,
    EXISTS(SELECT 1 FROM announcement_notifications n
      JOIN announcement_posts a ON a.announcement_id=n.announcement_id
      WHERE a.room_id=$1 AND n.state IN ('pending','sending','needs_reconcile'))
      AS unresolved_notifications`,[roomId,action==="finish"?"finished":"cancelled"]);
  const gate=checks.rows[0];
  if(!gate?.terminal_projected||gate.pending_events||gate.unconfirmed_edits||
     gate.unknown_deliveries||gate.unmarked_posts||gate.unresolved_notifications)
   throw new Error("ROOM_PUBLIC_STATUS_OR_NOTIFICATIONS_NOT_CONFIRMED");
  const linked=await client.query(
   "SELECT announcement_id FROM announcement_posts WHERE room_id=$1 ORDER BY announcement_id FOR UPDATE",
   [roomId]);
  const linkedIds=linked.rows.map(x=>Number(x.announcement_id));
  await client.query(
   `DELETE FROM room_status_message_edits WHERE room_event_id IN
       (SELECT event_id FROM room_source_events WHERE room_id=$1)`,[roomId]);
  // Do not retain personal application snapshots, meeting announcements,
  // Telegram delivery contents, notification payloads, event logs or URLs.
  if(linkedIds.length){
   await client.query(
    `DELETE FROM announcement_application_sessions
      WHERE token_hash IN (
       SELECT e.token_hash FROM announcement_application_entries e
        WHERE e.announcement_id=ANY($1::bigint[])
      )`,[linkedIds]);
   await client.query(
    "DELETE FROM announcement_application_entries WHERE announcement_id=ANY($1::bigint[])",
    [linkedIds]);
   await client.query(
    "DELETE FROM announcement_notifications WHERE announcement_id=ANY($1::bigint[])",
    [linkedIds]);
   await client.query(
    "DELETE FROM announcement_applications WHERE announcement_id=ANY($1::bigint[])",
    [linkedIds]);
   await client.query(
    "DELETE FROM announcement_room_dispatches WHERE announcement_id=ANY($1::bigint[])",
    [linkedIds]);
   await client.query(
    `DELETE FROM posting_deliveries
      WHERE source_type='announcement' AND source_id=ANY($1::text[])`,
    [linkedIds.map(String)]);
   await client.query(
    "DELETE FROM announcement_posts WHERE announcement_id=ANY($1::bigint[])",
    [linkedIds]);
  }
  await client.query(
   "DELETE FROM posting_deliveries WHERE source_type='room' AND source_id=$1",
   [String(roomId)]);
  await client.query("DELETE FROM room_host_sessions WHERE room_id=$1",[roomId]);
  await client.query("DELETE FROM room_participation_reports WHERE room_id=$1",[roomId]);
  // A room owner has just one ROOM draft at a time. Delete only the saved
  // draft tied to this meeting; preserve any newer independent draft.
  await client.query(
   `DELETE FROM public_post_drafts WHERE module='room'
      AND owner_user_id=$1 AND step='saved'
      AND data->>'roomId'=$2`,[ownerUserId,String(roomId)]);
  await client.query(
   "DELETE FROM announcement_room_dispatches WHERE room_event_id IN (SELECT event_id FROM room_source_events WHERE room_id=$1)",
   [roomId]);
  await client.query("DELETE FROM room_source_events WHERE room_id=$1",[roomId]);
  const removed=await client.query(
   "DELETE FROM room_posts WHERE room_id=$1 AND owner_user_id=$2 RETURNING room_id",
   [roomId,ownerUserId]);
  if(removed.rows.length!==1)throw new Error("ROOM_PURGE_INCOMPLETE");
  await client.query("COMMIT");
  return {roomId,status:action==="finish"?"finished":"cancelled",
    deletedAnnouncements:linkedIds.length};
 }catch(error){
  await client.query("ROLLBACK");
  throw error;
 }finally{client.release();}
}
