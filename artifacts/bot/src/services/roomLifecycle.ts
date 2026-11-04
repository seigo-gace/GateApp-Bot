/** ROOM is the only owner of host meeting state.
 * It emits durable source events; Announcement then handles notices/acceptance
 * and MPB only handles Telegram messages.
 */
import {pool} from "../db/index.js";
export type RoomState="draft"|"scheduled"|"ready"|"live"|"postponed"|"cancelled"|"finished";
export type RoomAction="schedule"|"prepare"|"start"|"postpone"|"cancel"|"finish";
export type RoomEventKind="scheduled"|"prepared"|"started"|"postponed"|"cancelled"|"finished"|"visibility_changed";
const map:Record<RoomAction,{to:RoomState;event:RoomEventKind;from:readonly RoomState[]}>={
 schedule:{to:"scheduled",event:"scheduled",from:["draft","postponed"]},
 prepare:{to:"ready",event:"prepared",from:["draft","scheduled","postponed"]},
 start:{to:"live",event:"started",from:["ready"]},
 postpone:{to:"postponed",event:"postponed",from:["scheduled","ready","live"]},
 cancel:{to:"cancelled",event:"cancelled",from:["draft","scheduled","ready","live","postponed"]},
 finish:{to:"finished",event:"finished",from:["live"]},
};
export function roomTransition(current:RoomState,action:RoomAction,startAt?:Date|null){
 const def=map[action];
 if(!def||!def.from.includes(current))throw new Error("ROOM_STATE_TRANSITION_INVALID");
 if(["schedule","postpone"].includes(action)&&
   (!startAt||!Number.isFinite(startAt.getTime())||startAt.getTime()<Date.now()+60000))
  throw new Error("ROOM_FUTURE_DATE_REQUIRED");
 return {state:def.to,event:def.event,startAt:startAt?.toISOString()||null};
}
export async function updateRoomState(
 hostUserId:number,roomId:number,expectedRevision:number,
 action:RoomAction,startAt?:Date
):Promise<{state:RoomState;revision:number;eventId:number}>{
 if(![hostUserId,roomId,expectedRevision].every(n=>Number.isSafeInteger(n)&&n>0))
  throw new Error("ROOM_OWNER_OR_REVISION_INVALID");
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const result=await c.query(
   `SELECT status,revision FROM room_posts
    WHERE room_id=$1 AND owner_user_id=$2 FOR UPDATE`,
   [roomId,hostUserId]);
  if(result.rows.length!==1)throw new Error("ROOM_NOT_OWNED");
  const row=result.rows[0];
  if(Number(row.revision)!==expectedRevision)throw new Error("ROOM_REVISION_STALE");
  const next=roomTransition(row.status,action,startAt);
  const changed=await c.query(
   `UPDATE room_posts SET status=$3,start_at=COALESCE($4,start_at),
      revision=revision+1,updated_at=NOW()
    WHERE room_id=$1 AND owner_user_id=$2 RETURNING revision`,
   [roomId,hostUserId,next.state,next.startAt]);
  const rev=Number(changed.rows[0].revision);
  const event=await c.query(
   `INSERT INTO room_source_events
     (room_id,source_revision,kind,payload)
    VALUES($1,$2,$3,$4::jsonb) RETURNING event_id`,
   [roomId,rev,next.event,JSON.stringify({startAt:next.startAt})]);
  await c.query("COMMIT");
  return {state:next.state,revision:rev,eventId:Number(event.rows[0].event_id)};
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
/** Only the host can explicitly change free-join vs approved-only mode;
 * never rewrite public MPB messages or join URLs from ROOM directly.
 */
export async function changeRoomVisibility(
 hostUserId:number,roomId:number,expectedRevision:number,
 visibility:"public"|"approved_only"
):Promise<{revision:number;eventId:number;visibility:string}>{
 if(![hostUserId,roomId,expectedRevision].every(x=>Number.isSafeInteger(x)&&x>0))
  throw new Error("ROOM_OWNER_OR_REVISION_INVALID");
 if(!["public","approved_only"].includes(visibility))throw new Error("ROOM_VISIBILITY_INVALID");
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const original=await c.query(
   `SELECT status,revision,join_visibility FROM room_posts
      WHERE room_id=$1 AND owner_user_id=$2 FOR UPDATE`,
   [roomId,hostUserId]);
  if(original.rows.length!==1)throw new Error("ROOM_NOT_OWNED");
  const room=original.rows[0];
  if(Number(room.revision)!==expectedRevision)throw new Error("ROOM_REVISION_STALE");
  if(!["draft","scheduled","ready"].includes(room.status))
   throw new Error("ROOM_VISIBILITY_CHANGE_NOT_ALLOWED_WHILE_ACTIVE");
  if(room.join_visibility===visibility)throw new Error("ROOM_VISIBILITY_UNCHANGED");
  const r=await c.query(
   `UPDATE room_posts SET join_visibility=$3,
      revision=revision+1,updated_at=NOW()
    WHERE room_id=$1 AND owner_user_id=$2 RETURNING revision`,
   [roomId,hostUserId,visibility]);
  const revision=Number(r.rows[0].revision);
  const event=await c.query(
   `INSERT INTO room_source_events(room_id,source_revision,kind,payload)
     VALUES($1,$2,'visibility_changed',$3::jsonb) RETURNING event_id`,
   [roomId,revision,JSON.stringify({visibility})]);
  await c.query("COMMIT");
  return {revision,eventId:Number(event.rows[0].event_id),visibility};
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
export async function reportRoomParticipation(
 reporterId:number,roomId:number,reason:"join_failed"|"left",description?:string
):Promise<void>{
 if(!Number.isSafeInteger(reporterId)||reporterId<=0||
    !Number.isSafeInteger(roomId)||roomId<=0)
  throw new Error("ROOM_REPORT_INVALID");
 if(description&&description.length>1000)throw new Error("ROOM_REPORT_TOO_LONG");
 await pool.query(
  `INSERT INTO room_participation_reports
   (room_id,reporter_user_id,report_type,description) VALUES($1,$2,$3,$4)`,
  [roomId,reporterId,reason,description||null]);
}
