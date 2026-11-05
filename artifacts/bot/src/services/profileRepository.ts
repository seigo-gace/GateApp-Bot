import { pool } from "../db/index.js";
import type { ProfileBasicDraft, ProfilePosition } from "./profileCore.js";
import {validateAppearance,type AppearanceValues} from "./profileAppearance.js";
import {validateProfileArea,type ProfileAreaValues} from "./profileArea.js";
import {validateProfileMedia,numberProfileMedia,type ProfileMediaItem} from "./profileMedia.js";
import {storeProfilePr,readProfilePr} from "./profilePrStorage.js";
import {validLikeTags,LIKE_CATEGORIES,type LikeTag} from "./profileLike.js";

export type ProfileDraft = {
  step: "awaiting_basic" | "awaiting_position" | "preview" | "appearance" | "hair" | "body" | "area-blocks" | "area-children" | "media" | "like-categories" | "like-items" | "cancelled";
  data: Partial<ProfileBasicDraft> & AppearanceValues & ProfileAreaValues & { screenMessageId?: number;pr?:string|null;prRef?:string|null;media?:ProfileMediaItem[];replaceMediaId?:number;mediaNextId?:number;mediaPage?:number;likeTags?:LikeTag[];likeCategory?:number;likePage?:number;loveTags?:LikeTag[];tagPurpose?:"like"|"love" };
  revision: number;
};
export type SavedProfile = ProfileBasicDraft & AppearanceValues & ProfileAreaValues & {pr?:string|null;prRef?:string|null;media?:ProfileMediaItem[];mediaNextId?:number;likeTags?:LikeTag[];loveTags?:LikeTag[]} & {
  position: ProfilePosition;
  username: string | null;
  status: string;
  revision: number;
};
function ownerId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("INVALID_PROFILE_OWNER");
  return id;
}
/** Cancel only the active draft; never delete the saved profile. */
export async function discardDraft(id: number, expectedRevision: number): Promise<boolean> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("PROFILE_DRAFT_STALE");
  // Keep a versioned tombstone. Deleting the row would reset revision to 1
  // on restart, allowing a stale mobile callback to cancel the new draft.
  const r = await pool.query(
    "UPDATE profile_drafts SET step='cancelled',data=jsonb_build_object('screenMessageId',data->'screenMessageId'),revision=revision+1,updated_at=NOW() WHERE owner_user_id=$1 AND revision=$2 AND step <> 'cancelled' RETURNING owner_user_id",
    [ownerId(id), expectedRevision],
  );
  return r.rows.length === 1;
}
/** Track the single Bot-owned wizard screen, without changing the callback revision. */
export async function bindScreenMessage(id: number, revision: number, messageId: number): Promise<void> {
  ownerId(id);
  if (!Number.isSafeInteger(revision) || revision < 1 ||
      !Number.isSafeInteger(messageId) || messageId < 1) throw new Error("PROFILE_SCREEN_INVALID");
  const r = await pool.query(
    "UPDATE profile_drafts SET data=jsonb_set(data,'{screenMessageId}',to_jsonb($3::integer),true) WHERE owner_user_id=$1 AND revision=$2 AND step <> 'cancelled' RETURNING owner_user_id",
    [id, revision, messageId]
  );
  if (!r.rows.length) throw new Error("PROFILE_DRAFT_STALE");
}
/** Only the prior Bot screen ID survives completion/cancel, never profile text. */
export async function getLastScreenMessageId(id:number):Promise<number|null>{
 const r=await pool.query(
  "SELECT data->>'screenMessageId' AS screen_id FROM profile_drafts WHERE owner_user_id=$1",
  [ownerId(id)]);
 const value=Number(r.rows[0]?.screen_id);
 return Number.isSafeInteger(value)&&value>0?value:null;
}
export async function getDraft(id: number): Promise<ProfileDraft | null> {
  const r = await pool.query(
    "SELECT step, data, revision FROM profile_drafts WHERE owner_user_id = $1",
    [ownerId(id)]
  );
  if (!r.rows.length || r.rows[0].step === "cancelled") return null;
  const data=r.rows[0].data as ProfileDraft["data"];
  if(data.likeTags!==undefined)data.likeTags=validLikeTags(data.likeTags);
  if(data.loveTags!==undefined)data.loveTags=validLikeTags(data.loveTags);
  if(data.prRef){
    data.pr=await readProfilePr(id,data.prRef);
  }
  return {step:r.rows[0].step, data, revision:r.rows[0].revision};
}
export async function putDraft(id: number, step: ProfileDraft["step"],
    data: ProfileDraft["data"], expectedRevision?: number): Promise<ProfileDraft> {
  ownerId(id);
  // No new PR body enters the PostgreSQL JSON draft. The text is stored
  // in a separately mounted, durable, verified object store first.
  const serialized={...data};
  if(serialized.likeTags!==undefined)serialized.likeTags=validLikeTags(serialized.likeTags);
  if(serialized.loveTags!==undefined)serialized.loveTags=validLikeTags(serialized.loveTags);
  if(serialized.media)serialized.media=numberProfileMedia(serialized.media);
  if(typeof serialized.pr==="string"&&serialized.pr.length){
    serialized.prRef=await storeProfilePr(id,serialized.pr);
  }else if(serialized.pr===null){
    serialized.prRef=null;
  }
  delete serialized.pr;
  const r = expectedRevision === undefined
    ? await pool.query(
      "INSERT INTO profile_drafts (owner_user_id,step,data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (owner_user_id) DO UPDATE SET step=EXCLUDED.step,data=EXCLUDED.data,revision=profile_drafts.revision+1,updated_at=NOW() RETURNING step,data,revision",
      [id,step,JSON.stringify(serialized)]
    )
    : await pool.query(
      "UPDATE profile_drafts SET step=$2,data=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE owner_user_id=$1 AND revision=$4 RETURNING step,data,revision",
      [id,step,JSON.stringify(serialized),expectedRevision]
    );
  if (!r.rows.length) throw new Error("PROFILE_DRAFT_STALE");
  const returned=r.rows[0].data as ProfileDraft["data"];
  if(returned.prRef)returned.pr=await readProfilePr(id,returned.prRef);
  return {step:r.rows[0].step,data:returned,revision:r.rows[0].revision};
}
export async function getProfile(id: number): Promise<SavedProfile | null> {
  const r = await pool.query(
    "SELECT nickname,username,height_cm,weight_kg,age,position,hair,body,region,area,pr,pr_ref,media_next_id,status,revision FROM profiles WHERE owner_user_id=$1",
    [ownerId(id)]
  );
  if (!r.rows.length) return null;
  const p = r.rows[0];
  const tagRows=await pool.query(
    "SELECT purpose,category,tag FROM profile_tags WHERE owner_user_id=$1 AND purpose IN ('like','love') ORDER BY purpose,category,tag",[id]);
  const isCurrentTag=(category:string,tag:string)=>LIKE_CATEGORIES.some(c=>c.name===category&&(c.items as readonly string[]).includes(tag));
  // Unknown historical tags remain in SQL; the current UI only edits adopted candidates.
  const likeTags=tagRows.rows.filter((x:{purpose:string;category:string;tag:string})=>x.purpose==="like"&&isCurrentTag(x.category,x.tag))
    .map((x:{category:string;tag:string})=>({category:x.category,tag:x.tag}));
  const loveTags=tagRows.rows.filter((x:{purpose:string;category:string;tag:string})=>x.purpose==="love"&&isCurrentTag(x.category,x.tag))
    .map((x:{category:string;tag:string})=>({category:x.category,tag:x.tag}));
  const mediaRows=await pool.query("SELECT id,item_id,file_id,media_type,source_message_id,media_group_id FROM profile_media WHERE owner_user_id=$1 ORDER BY id",[id]);
  const media:ProfileMediaItem[]=mediaRows.rows.map((m:{id:string|number;item_id:string|number|null;file_id:string;media_type:"photo"|"video";source_message_id:string|number|null;media_group_id:string|null})=>{
    // PostgreSQL BIGINT values arrive as strings with node-postgres.
    const itemId=Number(m.item_id??m.id);
    const sourceMessageId=Number(m.source_message_id??(Number(m.id)+2147483647));
    if(!Number.isSafeInteger(itemId)||itemId<=0||
       !Number.isSafeInteger(sourceMessageId)||sourceMessageId<=0)
      throw Error("PROFILE_MEDIA_PERSISTED_ID_INVALID");
    return {type:m.media_type,itemId,fileId:m.file_id,sourceMessageId,
      ...(m.media_group_id?{mediaGroupId:m.media_group_id}:{})};
  });
  const mediaNextId=Math.max(Number(p.media_next_id),1,...media.map(item=>(item.itemId??0)+1));
  if(!Number.isSafeInteger(mediaNextId)||mediaNextId<1)
    throw Error("PROFILE_MEDIA_COUNTER_INVALID");
  return {nickname:p.nickname, username:p.username,heightCm:p.height_cm,
    weightKg:p.weight_kg,age:p.age,position:p.position,hair:p.hair,body:p.body,region:p.region,area:p.area,
    pr:p.pr_ref?await readProfilePr(id,p.pr_ref):p.pr,prRef:p.pr_ref,media,mediaNextId,likeTags,loveTags,status:p.status,revision:p.revision};
}
export async function savePrivateDraft(id: number, revision: number,
    username: string | null): Promise<SavedProfile> {
  ownerId(id);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("PROFILE_DRAFT_STALE");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const draft = await client.query(
      "SELECT step,data,revision FROM profile_drafts WHERE owner_user_id=$1 FOR UPDATE",[id]);
    if (!draft.rows.length || draft.rows[0].revision !== revision ||
        !["preview","like-categories","like-items",
          "appearance","hair","body","area-blocks","area-children","media"].includes(draft.rows[0].step)) throw new Error("PROFILE_DRAFT_STALE");
    const p = draft.rows[0].data as ProfileBasicDraft & AppearanceValues & ProfileAreaValues & {pr?:string|null;prRef?:string|null;media?:ProfileMediaItem[];mediaNextId?:number;likeTags?:LikeTag[];loveTags?:LikeTag[]};
    if (!p || !p.position) throw new Error("PROFILE_INCOMPLETE");
    validateAppearance(p);
    validateProfileArea(p);
    validateProfileMedia(p.media);
    const numberedMedia=numberProfileMedia(p.media);
    const nextMediaId=Math.max(p.mediaNextId??1,...numberedMedia.map(item=>(item.itemId??0)+1),1);
    if(!Number.isSafeInteger(nextMediaId))throw Error("PROFILE_MEDIA_ID_INVALID");
    const saved = await client.query(
      `INSERT INTO profiles (owner_user_id,nickname,username,height_cm,weight_kg,age,position,hair,body,region,area,pr,pr_ref,media_next_id,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,'private')
       ON CONFLICT (owner_user_id) DO UPDATE SET
         nickname=EXCLUDED.nickname,username=EXCLUDED.username,
         height_cm=EXCLUDED.height_cm,weight_kg=EXCLUDED.weight_kg,
         age=EXCLUDED.age,position=EXCLUDED.position,
         hair=EXCLUDED.hair,body=EXCLUDED.body,
         region=EXCLUDED.region,area=EXCLUDED.area,pr=EXCLUDED.pr,pr_ref=EXCLUDED.pr_ref,media_next_id=EXCLUDED.media_next_id,
         revision=profiles.revision+1,updated_at=NOW()
       WHERE profiles.status='private'
       RETURNING nickname,username,height_cm,weight_kg,age,position,hair,body,region,area,pr,pr_ref,media_next_id,status,revision`,
      [id,p.nickname,username,p.heightCm,p.weightKg,p.age,p.position,p.hair??null,p.body??null,p.region??null,p.area??null,p.prRef??null,nextMediaId]
    );
    if (!saved.rows.length) throw new Error("PROFILE_PUBLISHED_EDIT_REQUIRES_SYNC");
    if(p.likeTags!==undefined||p.loveTags!==undefined){
      const catalog=LIKE_CATEGORIES.flatMap(category=>category.items.map((tag,i)=>({
        category:category.name,tag,ordinal:i+1,
      })));
      const catalogCategories=catalog.map(t=>t.category);
      const catalogTags=catalog.map(t=>t.tag);
      await client.query(
        `INSERT INTO profile_tag_catalog(category,tag,ordinal)
         SELECT category,tag,ordinal FROM UNNEST($1::text[],$2::text[],$3::int[])
         AS rows(category,tag,ordinal) ON CONFLICT(category,tag) DO NOTHING`,
        [catalogCategories,catalogTags,catalog.map(t=>t.ordinal)]);
      for(const purpose of ["like","love"] as const){
        const selection=purpose==="like"?p.likeTags:p.loveTags;
        if(selection===undefined)continue;
        const tags=validLikeTags(selection);
        // Delete only recognized keys for this purpose. Unknown historical rows
        // and the opposite purpose are deliberately left untouched.
        await client.query(
          `DELETE FROM profile_tags AS p WHERE p.owner_user_id=$1 AND p.purpose=$2
           AND (p.category,p.tag) IN (
             SELECT category,tag FROM UNNEST($3::text[],$4::text[]) AS t(category,tag)
           )`,
          [id,purpose,catalogCategories,catalogTags]);
        if(tags.length){
          await client.query(
            `INSERT INTO profile_tags(owner_user_id,purpose,category,tag)
             SELECT $1,$2,category,tag FROM UNNEST($3::text[],$4::text[]) AS t(category,tag)
             ON CONFLICT DO NOTHING`,
            [id,purpose,tags.map(t=>t.category),tags.map(t=>t.tag)]);
        }
      }
    }
    if(p.media!==undefined){
      await client.query("DELETE FROM profile_media WHERE owner_user_id=$1",[id]);
      for(const item of numberedMedia){
        await client.query("INSERT INTO profile_media (owner_user_id,item_id,file_id,media_type,source_message_id,media_group_id,public_allowed) VALUES ($1,$2,$3,$4,$5,$6,FALSE)",
         [id,item.itemId,item.fileId,item.type,item.sourceMessageId,item.mediaGroupId??null]);
      }
    }
    await client.query("UPDATE profile_drafts SET step='cancelled',data=jsonb_build_object('screenMessageId',data->'screenMessageId'),revision=revision+1,updated_at=NOW() WHERE owner_user_id=$1",[id]);
    await client.query("COMMIT");
    const x=saved.rows[0];
    return {nickname:x.nickname,username:x.username,heightCm:x.height_cm,
      weightKg:x.weight_kg,age:x.age,position:x.position,hair:x.hair,body:x.body,region:x.region,area:x.area,pr:x.pr_ref?await readProfilePr(id,x.pr_ref):x.pr,prRef:x.pr_ref,media:numberedMedia,mediaNextId:Number(x.media_next_id),likeTags:p.likeTags,loveTags:p.loveTags,status:x.status,revision:x.revision};
  } catch(e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

/** Profile source owns public-state transitions. MPB only owns delivery.
 * A Telegram success with a DB failure must be reconciled using delivery rows;
 * publishing again is NOT a recovery action.
 */
export async function recordProfilePublication(
 id:number,revision:number,chatId:number,threadId:number,messageId:number
):Promise<void>{
 ownerId(id);
 if(![revision,threadId,messageId].every(n=>Number.isSafeInteger(n)&&n>0)||
    !Number.isSafeInteger(chatId)||chatId>=0)
  throw new Error("PROFILE_PUBLICATION_INVALID");
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const p=await c.query(
   `UPDATE profiles SET status='published',updated_at=NOW()
    WHERE owner_user_id=$1 AND revision=$2 AND status IN ('private','published')
    RETURNING owner_user_id`,[id,revision]);
  if(p.rows.length!==1)throw new Error("PROFILE_REVISION_CHANGED_AFTER_SEND");
  await c.query(
   `INSERT INTO profile_publications
      (owner_user_id,chat_id,thread_id,message_id,status,synced_revision,updated_at)
    VALUES($1,$2,$3,$4,'published',$5,NOW())
    ON CONFLICT(owner_user_id,chat_id,thread_id) DO UPDATE SET
      message_id=EXCLUDED.message_id,status='published',
      synced_revision=EXCLUDED.synced_revision,last_error=NULL,updated_at=NOW()
    WHERE profile_publications.synced_revision IS NULL OR
      profile_publications.synced_revision<=EXCLUDED.synced_revision`,
   [id,chatId,threadId,messageId,revision]);
  await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
