/** Synchronous bounded public card readback for explicit host transitions.
 * Reuses the existing gated projector and MPB editor, not a new Telegram
 * sender. Terminal source state is durable even if card edits are pending.
 */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {projectNextRoomEvent} from "./announcementRoomEvents.js";
import {updateNextRoomStatusMessage} from "./roomPostStatus.js";

export type RoomPublicSyncResult="confirmed"|"pending"|"not_enabled";
export async function reconcileRoomPublicCard(
 telegram:Telegram,eventId:number,
):Promise<RoomPublicSyncResult>{
 if(!Number.isSafeInteger(eventId)||eventId<=0)throw Error("ROOM_EVENT_ID_INVALID");
 if(process.env.GAYBBS_ROOM_EVENT_WORKER_ENABLED!=="enabled"||
    process.env.GAYBBS_ROOM_STATUS_EDIT_ENABLED!=="enabled")return "not_enabled";
 // Keep existing FIFO projector ordering and verified delivery gates.
 // A terminal operation must not skip previous event revisions.
 for(let i=0;i<32;i++){
  const status=await pool.query(
   "SELECT state FROM room_source_events WHERE event_id=$1",[eventId]);
  if(status.rows.length!==1)return "pending";
  if(status.rows[0].state==="applied")break;
  const next=await projectNextRoomEvent();
  if(!next)break;
 }
 for(let i=0;i<32;i++){
  const pending=await pool.query(
   `SELECT state FROM room_status_message_edits WHERE room_event_id=$1`,[eventId]);
  if(!pending.rows.length)return "pending";
  if(pending.rows.every(row=>row.state==="confirmed"||row.state==="skipped"))
   return "confirmed";
  if(pending.rows.some(row=>row.state==="needs_reconcile"||row.state==="sending"))
   return "pending"; // Unknown Telegram outcome: never auto-retry.
  const updated=await updateNextRoomStatusMessage(telegram);
  if(!updated||updated.state!=="confirmed")return "pending";
 }
 return "pending";
}
