import { pool } from "../db/index.js";
import { createJitsiJoinUrl, type AnnouncementKind } from "./postingDomain.js";
import {validateLinkDraft,type LinkDraft} from "./linkButtonDomain.js";

export type PostModule="room"|"announcement"|"link";
export type EditorDraft={
 module:PostModule; step:"awaiting_kind"|"awaiting_text"|"awaiting_datetime"|"awaiting_tags"|"preview"|"saved"|"published";
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
/** Persist only the current private Bot wizard message; do not bump action revision. */
export async function bindDraftScreen(id:number,module:PostModule,revision:number,
 messageId:number):Promise<void>{
 if(!Number.isSafeInteger(messageId)||messageId<=0||
    !Number.isSafeInteger(revision)||revision<=0)throw new Error("POST_SCREEN_INVALID");
 const r=await pool.query(
  "UPDATE public_post_drafts SET data=jsonb_set(data,'{screenMessageId}',to_jsonb($4::integer),true) WHERE owner_user_id=$1 AND module=$2 AND revision=$3 RETURNING owner_user_id",
  [validOwner(id),module,revision,messageId]);
 if(r.rows.length!==1)throw new Error("POST_DRAFT_STALE");
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
   VALUES($1,$2,$3,$4,$5,'draft')
   ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key
   RETURNING room_id,join_url`,
  [key,id,title,mode,joinUrl]
 );
 return {sourceId:String(r.rows[0].room_id),joinUrl:String(r.rows[0].join_url)};
}
export async function createAnnouncement(id:number,revision:number,kind:AnnouncementKind,text:string,eventAt?:Date,purposeCodes:string[]=[],placeCodes:string[]=[],linkedRoomId?:number):
 Promise<{sourceId:string}>{
 const key=(linkedRoomId?"room-announcement:":"announcement:")+validOwner(id)+":"+revision;
 const r=await pool.query(
  `INSERT INTO announcement_posts(request_key,owner_user_id,kind,text,event_at,purpose_codes,place_codes,room_id,status)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft')
   ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key
   RETURNING announcement_id`,
  [key,id,kind,text,eventAt||null,purposeCodes,placeCodes,linkedRoomId||null]
 );
 return {sourceId:String(r.rows[0].announcement_id)};
}
export async function markDraftPublished(id:number,module:PostModule,revision:number):Promise<void>{
 // Source and Telegram receipt are durable owners. Once published, there is
 // no reason to retain the sensitive temporary editor payload in another row.
 const r=await pool.query(
  `DELETE FROM public_post_drafts
   WHERE owner_user_id=$1 AND module=$2 AND revision=$3 AND step='preview'
   RETURNING owner_user_id`,
  [validOwner(id),module,revision]
 );
 if(r.rows.length!==1)throw new Error("POST_DRAFT_FINALIZATION_NEEDS_RECONCILE");
}

/** A private ROOM is saved without publishing a Telegram URL or post. */
export async function markRoomDraftSaved(id:number,revision:number,roomId:number):Promise<void>{
 if(!Number.isSafeInteger(roomId)||roomId<=0)throw new Error("ROOM_ID_INVALID");
 const r=await pool.query(
  `UPDATE public_post_drafts
     SET step='saved',data=jsonb_build_object('roomId',$3::bigint),updated_at=NOW()
   WHERE owner_user_id=$1 AND module='room' AND revision=$2
     AND step IN ('preview','saved') RETURNING owner_user_id`,
  [validOwner(id),revision,roomId]);
 if(r.rows.length!==1)throw new Error("ROOM_DRAFT_STALE");
}

/** Idempotent LinkButton source. MPB stores Telegram message IDs separately. */
export async function createLinkButton(id:number,revision:number,draft:LinkDraft):
 Promise<{sourceId:string}>{
 validOwner(id);validateLinkDraft(draft);
 const key="link:"+id+":"+revision;
 const r=await pool.query(
  `INSERT INTO link_button_posts(request_key,owner_user_id,content,buttons,columns)
   VALUES($1,$2,$3,$4::jsonb,$5)
   ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key
   RETURNING link_post_id`,
  [key,id,draft.text,JSON.stringify(draft.buttons),draft.columns]
 );
 return {sourceId:String(r.rows[0].link_post_id)};
}

/** Source owner transitions after an MPB send receipt. The delivery adapter
 * never writes the business tables. Failed state sync is reported as reconcile.
 */
export async function markPostSourcePublished(
 ownerId:number,module:PostModule,sourceId:string
):Promise<void>{
 validOwner(ownerId);
 if(!/^\d+$/.test(sourceId))throw new Error("POST_SOURCE_ID_INVALID");
 const table=module==="link"?"link_button_posts":"announcement_posts";
 const idColumn=module==="link"?"link_post_id":"announcement_id";
 const next=module==="link"?
  `UPDATE link_button_posts SET status='published',updated_at=NOW()
    WHERE link_post_id=$1 AND owner_user_id=$2
      AND status IN ('draft','published') RETURNING link_post_id`:
  `UPDATE announcement_posts SET status='published',
      accept_applications=CASE WHEN kind='recruitment' THEN TRUE ELSE FALSE END,
      updated_at=NOW()
    WHERE announcement_id=$1 AND owner_user_id=$2
      AND status IN ('draft','publishing','published') RETURNING announcement_id`;
 const r=await pool.query(next,[sourceId,ownerId]);
 if(r.rows.length!==1)throw new Error("POST_SOURCE_SYNC_NEEDS_RECONCILE");
}
