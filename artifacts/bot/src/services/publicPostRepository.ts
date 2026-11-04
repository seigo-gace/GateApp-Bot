import { pool } from "../db/index.js";
import { createJitsiJoinUrl, type AnnouncementKind } from "./postingDomain.js";

export type PostModule="room"|"announcement";
export type EditorDraft={
 module:PostModule; step:"awaiting_kind"|"awaiting_text"|"awaiting_datetime"|"awaiting_tags"|"preview"|"published";
 revision:number; data:Record<string,unknown>;
};
function validOwner(id:number):number{
 if(!Number.isSafeInteger(id)||id<=0)throw new Error("POST_OWNER_INVALID");
 return id;
}
export async function beginDraft(id:number,module:PostModule,step:EditorDraft["step"],
 data:Record<string,unknown>={}):Promise<EditorDraft>{
 const r=await pool.query(
  `INSERT INTO public_post_drafts(owner_user_id,module,step,data)
   VALUES ($1,$2,$3,$4::jsonb)
   ON CONFLICT (owner_user_id,module) DO UPDATE
   SET step=EXCLUDED.step,data=EXCLUDED.data,revision=public_post_drafts.revision+1,updated_at=NOW()
   RETURNING step,data,revision`,[validOwner(id),module,step,JSON.stringify(data)]
 );
 return {module,step:r.rows[0].step,data:r.rows[0].data,revision:r.rows[0].revision};
}
export async function getDraft(id:number,module:PostModule):Promise<EditorDraft|null>{
 const r=await pool.query(
  "SELECT step,data,revision FROM public_post_drafts WHERE owner_user_id=$1 AND module=$2",
  [validOwner(id),module]
 );
 return r.rows[0]?{module,...r.rows[0]}:null;
}
export async function getWaitingDraft(id:number):Promise<EditorDraft|null>{
 const r=await pool.query(
  `SELECT module,step,data,revision FROM public_post_drafts
   WHERE owner_user_id=$1 AND step IN ('awaiting_text','awaiting_datetime')
   ORDER BY updated_at DESC LIMIT 1`,[validOwner(id)]
 );
 return r.rows[0]??null;
}
export async function updateDraft(id:number,module:PostModule,revision:number,
 step:EditorDraft["step"],data:Record<string,unknown>):Promise<EditorDraft>{
 const r=await pool.query(
  `UPDATE public_post_drafts SET step=$4,data=$5::jsonb,revision=revision+1,updated_at=NOW()
   WHERE owner_user_id=$1 AND module=$2 AND revision=$3
   RETURNING step,data,revision`,
  [validOwner(id),module,revision,step,JSON.stringify(data)]
 );
 if(r.rows.length!==1)throw new Error("POST_DRAFT_STALE");
 return {module,...r.rows[0]};
}
export async function createRoom(id:number,revision:number,title:string,externalUrl?:string):
 Promise<{sourceId:string;joinUrl:string}>{
 const key="room:"+validOwner(id)+":"+revision;
 const joinUrl=externalUrl||createJitsiJoinUrl();
 const mode=externalUrl?"external":"jitsi";
 const r=await pool.query(
  `INSERT INTO room_posts(request_key,owner_user_id,title,mode,join_url,status)
   VALUES($1,$2,$3,$4,$5,'ready')
   ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key
   RETURNING room_id,join_url`,
  [key,id,title,mode,joinUrl]
 );
 return {sourceId:String(r.rows[0].room_id),joinUrl:String(r.rows[0].join_url)};
}
export async function createAnnouncement(id:number,revision:number,kind:AnnouncementKind,text:string,eventAt?:Date,purposeCodes:string[]=[],placeCodes:string[]=[]):
 Promise<{sourceId:string}>{
 const key="announcement:"+validOwner(id)+":"+revision;
 const r=await pool.query(
  `INSERT INTO announcement_posts(request_key,owner_user_id,kind,text,event_at,purpose_codes,place_codes,status)
   VALUES($1,$2,$3,$4,$5,$6,$7,'draft')
   ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key
   RETURNING announcement_id`,
  [key,id,kind,text,eventAt||null,purposeCodes,placeCodes]
 );
 return {sourceId:String(r.rows[0].announcement_id)};
}
export async function markDraftPublished(id:number,module:PostModule,revision:number):Promise<void>{
 await pool.query(
  `UPDATE public_post_drafts SET step='published',updated_at=NOW()
   WHERE owner_user_id=$1 AND module=$2 AND revision=$3 AND step='preview'`,
  [validOwner(id),module,revision]
 );
}
