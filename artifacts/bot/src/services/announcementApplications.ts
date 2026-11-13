/** Adopted Notion02 application/approval atomic state machine.
 * Business state belongs only to Announcement, not MPB or Profile.
 * All notifications are queued in the same DB transaction, NOT sent inside it.
 */
import {pool} from "../db/index.js";
import {type RecruitmentInput} from "./recruitmentCompose.js";
import type {ProfileBasicDraft} from "./profileCore.js";
import {renderRoomApplicationPreview} from "./roomApplicationTags.js";
import {validLikeTags} from "./profileLike.js";
export type ApplicationDecision="accepted"|"declined"|"held";
function validId(id:number):number{
 if(!Number.isSafeInteger(id)||id<=0)throw new Error("APPLICATION_ID_INVALID");
 return id;
}
export async function submitApplication(
 announcementId:number,applicantId:number,consentedProfile:Record<string,unknown>|null
):Promise<{applicationId:number;status:string;duplicate:boolean}>{
 validId(announcementId);validId(applicantId);
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const post=await c.query(
   `SELECT owner_user_id,kind,status,capacity,accept_applications,deadline_at
    FROM announcement_posts WHERE announcement_id=$1 FOR UPDATE`,[announcementId]);
  if(post.rows.length!==1||post.rows[0].kind!=="recruitment"||
    post.rows[0].status!=="published"||post.rows[0].accept_applications!==true)
   throw new Error("APPLICATIONS_CLOSED");
  const p=post.rows[0];
  if(Number(p.owner_user_id)===applicantId)throw new Error("SELF_APPLICATION_REFUSED");
  if(p.deadline_at && new Date(p.deadline_at).getTime()<=Date.now())
   throw new Error("APPLICATION_DEADLINE_PASSED");
  if(p.capacity!==null){
   const count=await c.query(
    `SELECT count(*)::int AS n FROM announcement_applications
     WHERE announcement_id=$1 AND status='accepted'`,[announcementId]);
   if(Number(count.rows[0].n)>=Number(p.capacity))
    throw new Error("APPLICATION_CAPACITY_FILLED");
  }
  const insert=await c.query(
   `INSERT INTO announcement_applications
     (announcement_id,applicant_user_id,consented_profile)
    VALUES($1,$2,$3::jsonb)
    ON CONFLICT(announcement_id,applicant_user_id) DO NOTHING
    RETURNING application_id,status`,
   [announcementId,applicantId,JSON.stringify(consentedProfile)]);
  const duplicate=insert.rows.length===0;
  const row=duplicate?(await c.query(
   `SELECT application_id,status FROM announcement_applications
    WHERE announcement_id=$1 AND applicant_user_id=$2`,
   [announcementId,applicantId])).rows[0]:insert.rows[0];
  if(!row)throw new Error("APPLICATION_RECORD_MISSING");
  if(!duplicate){
   await c.query(
    `INSERT INTO announcement_notifications
      (announcement_id,recipient_user_id,event_key,payload)
     VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(event_key) DO NOTHING`,
    [announcementId,p.owner_user_id,
     "application:"+row.application_id+":submitted",
     JSON.stringify({applicationId:row.application_id,action:"submitted"})]);
  }
  await c.query("COMMIT");
  return {applicationId:Number(row.application_id),status:row.status,duplicate};
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
export async function decideApplication(
 ownerUserId:number,announcementId:number,applicationId:number,
 decision:ApplicationDecision
):Promise<{status:ApplicationDecision;filled:boolean}>{
 validId(ownerUserId);validId(announcementId);validId(applicationId);
 if(!["accepted","declined","held"].includes(decision))
  throw new Error("APPLICATION_DECISION_INVALID");
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const post=await c.query(
   `SELECT owner_user_id,status,kind,capacity,accept_applications
    FROM announcement_posts WHERE announcement_id=$1 FOR UPDATE`,[announcementId]);
  if(post.rows.length!==1||Number(post.rows[0].owner_user_id)!==ownerUserId)
   throw new Error("APPLICATION_OWNER_MISMATCH");
  const p=post.rows[0];
  if(p.kind!=="recruitment"||p.status!=="published"||!p.accept_applications)
   throw new Error("APPLICATIONS_CLOSED");
  const app=await c.query(
   `SELECT applicant_user_id,status FROM announcement_applications
    WHERE application_id=$1 AND announcement_id=$2 FOR UPDATE`,
   [applicationId,announcementId]);
  if(app.rows.length!==1||!["submitted","held"].includes(app.rows[0].status))
   throw new Error("APPLICATION_ALREADY_DECIDED");
  if(decision==="accepted"&&p.capacity!==null){
   const taken=await c.query(
    `SELECT count(*)::int AS n FROM announcement_applications
    WHERE announcement_id=$1 AND status='accepted'`,[announcementId]);
   if(Number(taken.rows[0].n)>=Number(p.capacity))
    throw new Error("APPLICATION_CAPACITY_FILLED");
  }
  await c.query(
   `UPDATE announcement_applications SET status=$1,updated_at=NOW()
    WHERE application_id=$2`,[decision,applicationId]);
  let filled=false;
  if(decision==="accepted"&&p.capacity!==null){
   const taken=await c.query(
    `SELECT count(*)::int AS n FROM announcement_applications
    WHERE announcement_id=$1 AND status='accepted'`,[announcementId]);
   filled=Number(taken.rows[0].n)>=Number(p.capacity);
  }
  await c.query(
   `UPDATE announcement_posts SET revision=revision+1,
      status=CASE WHEN $2 THEN 'filled' ELSE status END,
      accept_applications=CASE WHEN $2 THEN FALSE ELSE accept_applications END,
      updated_at=NOW() WHERE announcement_id=$1`,[announcementId,filled]);
  await c.query(
   `INSERT INTO announcement_notifications
     (announcement_id,recipient_user_id,event_key,payload)
    VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(event_key) DO NOTHING`,
   [announcementId,app.rows[0].applicant_user_id,
    "application:"+applicationId+":"+decision,
    JSON.stringify({applicationId,action:decision})]);
  await c.query("COMMIT");
  return {status:decision,filled};
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
export async function withdrawApplication(
 applicantId:number,announcementId:number
):Promise<boolean>{
 validId(applicantId);validId(announcementId);
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const x=await c.query(
   `UPDATE announcement_applications SET status='withdrawn',updated_at=NOW()
    WHERE announcement_id=$1 AND applicant_user_id=$2
      AND status IN ('submitted','held')
    RETURNING application_id`,[announcementId,applicantId]);
  await c.query("COMMIT");
  return x.rows.length===1;
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}

/** One presentation shared by the owner DM notification and /applications.
 * Application data was explicitly submitted by the applicant. The meeting
 * URL, raw applicant ID and chat/topic IDs are never part of this card.
 */
export function renderRoomApplicantSummary(value:Record<string,unknown>|null):string{
 if(!value)throw Error("ROOM_APPLICANT_CONTENT_MISSING");
 const mode=value.mode==="linked"?"linked":"manual";
 const input:RecruitmentInput={
  mode,title:String(value.title||""),body:String(value.body||""),
  nickname:typeof value.nickname==="string"?value.nickname:undefined,
  heightCm:Number(value.heightCm)||undefined,
  weightKg:Number(value.weightKg)||undefined,
  age:Number(value.age)||undefined,
  position:typeof value.position==="string"?value.position:undefined,
  purposeCodes:[],placeCodes:[],
 };
 if(!input.title.trim())throw Error("ROOM_APPLICATION_CONTENT_INCOMPLETE");
 const profile=mode==="linked"?value as unknown as ProfileBasicDraft:null;
 return "📝 ROOMへの応募\n"+renderRoomApplicationPreview({
  ...input,
  likeTags:validLikeTags(value.likeTags as []??[]),
  loveTags:validLikeTags(value.loveTags as []??[]),
 },profile);
}
