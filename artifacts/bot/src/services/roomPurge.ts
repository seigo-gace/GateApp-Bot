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
  if(action==="finish"&&room.status!=="live")
   throw new Error("ROOM_NOT_LIVE");
  if(action==="cancel"&&!["draft","scheduled","ready","live","postponed"].includes(room.status))
   throw new Error("ROOM_NOT_CANCELLABLE");
  const linked=await client.query(
   "SELECT announcement_id FROM announcement_posts WHERE room_id=$1 ORDER BY announcement_id FOR UPDATE",
   [roomId]);
  const linkedIds=linked.rows.map(x=>Number(x.announcement_id));
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
