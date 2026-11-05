import { pool } from "../db/index.js";
import type { ProfileBasicDraft, ProfilePosition } from "./profileCore.js";

export type ProfileDraft = {
  step: "awaiting_basic" | "awaiting_position" | "preview" | "cancelled";
  data: Partial<ProfileBasicDraft>;
  revision: number;
};
export type SavedProfile = ProfileBasicDraft & {
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
    "UPDATE profile_drafts SET step='cancelled',data='{}'::jsonb,revision=revision+1,updated_at=NOW() WHERE owner_user_id=$1 AND revision=$2 AND step <> 'cancelled' RETURNING owner_user_id",
    [ownerId(id), expectedRevision],
  );
  return r.rows.length === 1;
}
export async function getDraft(id: number): Promise<ProfileDraft | null> {
  const r = await pool.query(
    "SELECT step, data, revision FROM profile_drafts WHERE owner_user_id = $1",
    [ownerId(id)]
  );
  if (!r.rows.length || r.rows[0].step === "cancelled") return null;
  return {step:r.rows[0].step, data:r.rows[0].data, revision:r.rows[0].revision};
}
export async function putDraft(id: number, step: ProfileDraft["step"],
    data: ProfileDraft["data"], expectedRevision?: number): Promise<ProfileDraft> {
  ownerId(id);
  const r = expectedRevision === undefined
    ? await pool.query(
      "INSERT INTO profile_drafts (owner_user_id,step,data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (owner_user_id) DO UPDATE SET step=EXCLUDED.step,data=EXCLUDED.data,revision=profile_drafts.revision+1,updated_at=NOW() RETURNING step,data,revision",
      [id,step,JSON.stringify(data)]
    )
    : await pool.query(
      "UPDATE profile_drafts SET step=$2,data=$3::jsonb,revision=revision+1,updated_at=NOW() WHERE owner_user_id=$1 AND revision=$4 RETURNING step,data,revision",
      [id,step,JSON.stringify(data),expectedRevision]
    );
  if (!r.rows.length) throw new Error("PROFILE_DRAFT_STALE");
  return {step:r.rows[0].step,data:r.rows[0].data,revision:r.rows[0].revision};
}
export async function getProfile(id: number): Promise<SavedProfile | null> {
  const r = await pool.query(
    "SELECT nickname,username,height_cm,weight_kg,age,position,status,revision FROM profiles WHERE owner_user_id=$1",
    [ownerId(id)]
  );
  if (!r.rows.length) return null;
  const p = r.rows[0];
  return {nickname:p.nickname, username:p.username,heightCm:p.height_cm,
    weightKg:p.weight_kg,age:p.age,position:p.position,status:p.status,revision:p.revision};
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
        draft.rows[0].step !== "preview") throw new Error("PROFILE_DRAFT_STALE");
    const p = draft.rows[0].data as ProfileBasicDraft;
    if (!p || !p.position) throw new Error("PROFILE_INCOMPLETE");
    const saved = await client.query(
      "INSERT INTO profiles (owner_user_id,nickname,username,height_cm,weight_kg,age,position,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'private') ON CONFLICT (owner_user_id) DO UPDATE SET nickname=EXCLUDED.nickname,username=EXCLUDED.username,height_cm=EXCLUDED.height_cm,weight_kg=EXCLUDED.weight_kg,age=EXCLUDED.age,position=EXCLUDED.position,revision=profiles.revision+1,updated_at=NOW() WHERE profiles.status='private' RETURNING nickname,username,height_cm,weight_kg,age,position,status,revision",
      [id,p.nickname,username,p.heightCm,p.weightKg,p.age,p.position]
    );
    if (!saved.rows.length) throw new Error("PROFILE_PUBLISHED_EDIT_REQUIRES_SYNC");
    await client.query("UPDATE profile_drafts SET step='cancelled',data='{}'::jsonb,revision=revision+1,updated_at=NOW() WHERE owner_user_id=$1",[id]);
    await client.query("COMMIT");
    const x=saved.rows[0];
    return {nickname:x.nickname,username:x.username,heightCm:x.height_cm,
      weightKg:x.weight_kg,age:x.age,position:x.position,status:x.status,revision:x.revision};
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
