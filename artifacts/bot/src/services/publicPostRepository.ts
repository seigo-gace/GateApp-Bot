import { pool } from "../db/index.js";
import { createJitsiJoinUrl, type AnnouncementKind } from "./postingDomain.js";
import {validateLinkDraft,type LinkDraft} from "./linkButtonDomain.js";

export type PostModule="room"|"announcement"|"link";
export type EditorDraft={
 module:PostModule; step:"awaiting_kind"|"awaiting_text"|"awaiting_media"|"awaiting_recruitment_edit"|"cancelled"|"awaiting_datetime"|"awaiting_room_url"|"awaiting_tags"|"preview"|"saved"|"published";
 revision:number; data:Record<string,unknown>;
};
function validOwner(id:number):number{
 if(!Number.isSafeInteger(id)||id<=0)throw new Error("POST_OWNER_INVALID");
 return id;
}
export async function beginDraft(id:number,module:PostModule,step:EditorDraft["step"],
 data:Record<string,unknown>={}):Promise<EditorDraft>{
 // Standalone notice sources retain their request key after temporary drafts
 // are removed. Allocate above the owner's previous legacy announcement keys
 // so a new notice never aliases an earlier source/delivery. Other modules
 // retain the existing revision allocation.
 if(module==="announcement"&&(data.kind==="announcement"||data.kind==="preview"||data.kind==="recruitment")){
  const r=await pool.query(
   `INSERT INTO public_post_drafts(owner_user_id,module,step,data,revision)
    SELECT $1::bigint,'announcement',$2::text,$3::jsonb,
      (COALESCE(MAX(CASE WHEN request_key ~ ('^announcement:'||$1::bigint::text||':[0-9]{1,10}$')
        THEN split_part(request_key,':',3)::bigint END),0)+1)::integer
    FROM announcement_posts WHERE owner_user_id=$1::bigint
    ON CONFLICT(owner_user_id,module) DO UPDATE SET
     step=EXCLUDED.step,data=EXCLUDED.data,
     revision=GREATEST(public_post_drafts.revision+1,EXCLUDED.revision),updated_at=NOW()
    RETURNING step,data,revision`,[validOwner(id),step,JSON.stringify(data)]);
  return {module,...r.rows[0]};
 }
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
/** Record only Bot-owned native sticker preview receipts on this notice revision. */
export async function bindNoticeStickerPreviews(id:number,revision:number,previews:readonly {fileId:string;messageId:number|null}[]):Promise<void>{
 const r=await pool.query(
  "UPDATE public_post_drafts SET data=jsonb_set(data,'{noticeStickerPreviews}',$3::jsonb,true) WHERE owner_user_id=$1 AND module='announcement' AND revision=$2 RETURNING owner_user_id",
  [validOwner(id),revision,JSON.stringify(previews)]);
 if(r.rows.length!==1)throw Error("POST_DRAFT_STALE");
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
   WHERE owner_user_id=$1 AND step IN ('awaiting_text','awaiting_datetime','awaiting_room_url')
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
export async function createRoom(id:number,revision:number,title:string,externalUrl?:string,
 options?:{description?:string;scheduledAt?:Date;visibility?:"public"|"approved_only"}):
 Promise<{sourceId:string;joinUrl:string}>{
 const key="room:"+validOwner(id)+":"+revision;
 const joinUrl=externalUrl||createJitsiJoinUrl();
 const mode=externalUrl?"external":"jitsi";
 const description=options?.description??"";
 if(description.length>3500)throw new Error("ROOM_DESCRIPTION_TOO_LONG");
 const scheduledAt=options?.scheduledAt;
 if(scheduledAt&&(!Number.isFinite(scheduledAt.getTime())||scheduledAt.getTime()<Date.now()))
  throw new Error("ROOM_FUTURE_DATE_REQUIRED");
 const visibility=options?.visibility??"approved_only";
 const r=await pool.query(
  `INSERT INTO room_posts
     (request_key,owner_user_id,title,description,mode,join_url,status,start_at,join_visibility)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
   ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key
   RETURNING room_id,join_url`,
  [key,id,title,description,mode,joinUrl,
   scheduledAt?"scheduled":"draft",scheduledAt??null,visibility]
 );
 return {sourceId:String(r.rows[0].room_id),joinUrl:String(r.rows[0].join_url)};
}
export async function createAnnouncement(id:number,revision:number,kind:AnnouncementKind,text:string,eventAt?:Date,purposeCodes:string[]=[],placeCodes:string[]=[],linkedRoomId?:number,
 details?:{profileSnapshot?:Record<string,unknown>|null;conditions?:Record<string,unknown>}):
 Promise<{sourceId:string}>{
 const key=(linkedRoomId?"room-announcement:":"announcement:")+validOwner(id)+":"+revision;
 const r=await pool.query(
  `INSERT INTO announcement_posts
     (request_key,owner_user_id,kind,text,event_at,purpose_codes,place_codes,room_id,
      profile_snapshot,conditions,status,deadline_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,'draft',NULLIF($11::text,'')::timestamptz)
   ON CONFLICT(request_key) DO UPDATE SET request_key=EXCLUDED.request_key
   RETURNING announcement_id`,
  [key,id,kind,text,eventAt||null,purposeCodes,placeCodes,linkedRoomId||null,
   details?.profileSnapshot?JSON.stringify(details.profileSnapshot):null,
   JSON.stringify(details?.conditions??{}),String(details?.conditions?.deadlineAt??"")]
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

/** Save an announcement editor only. No published Announcement or MPB intent
 * is generated until the owner explicitly chooses a verified destination.
 */
export async function saveAnnouncementEditorDraft(id:number,revision:number):Promise<void>{
 const result=await pool.query(
  `UPDATE public_post_drafts SET step='saved',updated_at=NOW()
     WHERE owner_user_id=$1 AND module='announcement'
       AND revision=$2 AND step IN ('preview','awaiting_text')
     RETURNING owner_user_id`,
  [validOwner(id),revision]);
 if(result.rows.length!==1)throw new Error("ANNOUNCEMENT_DRAFT_STALE");
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

/** A saved ROOM editor is private text/selection data, not a published room.
 * Reopening /room can restore it without creating a duplicate room record.
 */
export async function saveRoomEditorDraft(id:number,revision:number):Promise<void>{
 const q=await pool.query(
  `UPDATE public_post_drafts SET step='saved',
     data=data - 'savedTemplate',updated_at=NOW()
   WHERE owner_user_id=$1 AND module='room' AND revision=$2 AND step='preview'
   RETURNING owner_user_id`,[validOwner(id),revision]);
 if(q.rows.length!==1)throw new Error("ROOM_DRAFT_STALE");
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
      accept_applications=CASE WHEN room_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM room_posts r WHERE r.room_id=announcement_posts.room_id
         AND r.join_visibility='approved_only' AND r.status IN ('draft','scheduled','ready')
      ) THEN TRUE
      WHEN room_id IS NULL AND kind IN ('announcement','preview')
        AND conditions->>'participation' IN ('public','approved_only') THEN TRUE
      ELSE FALSE END,
      updated_at=NOW()
    WHERE announcement_id=$1 AND owner_user_id=$2
      AND status IN ('draft','publishing','published') RETURNING announcement_id`;
 const r=await pool.query(next,[sourceId,ownerId]);
 if(r.rows.length!==1)throw new Error("POST_SOURCE_SYNC_NEEDS_RECONCILE");
}
