/** Recruitment CTA for the same GayBBS DM bot: opaque token,
 * no raw announcement/group/thread IDs supplied by users.
 */
import {randomBytes,createHash} from "node:crypto";
import {pool} from "../db/index.js";
const re=/^[A-Za-z0-9_-]{32}$/;
export function newApplicationToken():string{
 return randomBytes(24).toString("base64url");
}
export function applicationTokenHash(token:string):string{
 if(!re.test(token))throw new Error("APPLICATION_TOKEN_INVALID");
 return createHash("sha256").update("GayBBS-application-v1:").update(token).digest("hex");
}
export async function makeApplicationLink(
 ownerId:number,announcementId:number
):Promise<string>{
 const a=await pool.query(
  `SELECT announcement_id FROM announcement_posts WHERE announcement_id=$1
   AND owner_user_id=$2 AND kind='recruitment'
   AND status IN ('draft','published')`,[announcementId,ownerId]);
 if(a.rows.length!==1)throw new Error("APPLICATION_SOURCE_NOT_OWNED");
 const token=newApplicationToken();
 await pool.query(
  `INSERT INTO announcement_application_entries(token_hash,announcement_id,expires_at)
   VALUES($1,$2,NOW()+INTERVAL '365 days')`,
  [applicationTokenHash(token),announcementId]);
 return "https://t.me/GayBBS_bot?start=a_"+token;
}
/** Distinguish adopted ROOM applications from legacy plain recruitment contact.
 * This lookup does not create an application or authorize a ROOM join.
 */
export async function isRoomApplicationLink(payload:string):Promise<boolean>{
 const match=/^a_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match)return false;
 const key=applicationTokenHash(match[1]!);
 const r=await pool.query(
  `SELECT p.room_id FROM announcement_application_entries e
    JOIN announcement_posts p ON p.announcement_id=e.announcement_id
    WHERE e.token_hash=$1`,[key]);
 return r.rows.length===1&&r.rows[0].room_id!==null;
}
export async function activateApplicationSession(
 applicantId:number,payload:string
):Promise<{announcementId:number;body:string}>{
 const match=/^a_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match||!Number.isSafeInteger(applicantId)||applicantId<=0)
  throw new Error("APPLICATION_LINK_INVALID");
 const key=applicationTokenHash(match[1]!);
 const res=await pool.query(
  `SELECT p.announcement_id,p.text,p.owner_user_id,p.kind,p.status,
          p.accept_applications,p.deadline_at,p.room_id
   FROM announcement_application_entries e
   JOIN announcement_posts p ON p.announcement_id=e.announcement_id
   WHERE e.token_hash=$1 AND e.enabled=TRUE AND e.expires_at>NOW()`,[key]);
 if(res.rows.length!==1)throw new Error("APPLICATION_LINK_EXPIRED");
 const p=res.rows[0];
 if(p.kind!=="recruitment"||p.room_id===null||Number(p.owner_user_id)===applicantId)
  throw new Error("SELF_APPLICATION_REFUSED");
 if(p.status!=="published"||p.accept_applications!==true||
    (p.deadline_at&&new Date(p.deadline_at).getTime()<=Date.now()))
  throw new Error("APPLICATIONS_CLOSED");
 await pool.query(
  `INSERT INTO announcement_application_sessions(applicant_user_id,token_hash,expires_at)
   VALUES($1,$2,NOW()+INTERVAL '24 hours')
   ON CONFLICT(applicant_user_id) DO UPDATE SET
    token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,
    draft='{}'::jsonb,draft_step='awaiting_text',screen_message_id=NULL,created_at=NOW()`,
  [applicantId,key]);
 return {announcementId:Number(p.announcement_id),body:String(p.text)};
}
export async function resolveApplicationSession(
 applicantId:number
):Promise<{announcementId:number}|null>{
 const res=await pool.query(
  `SELECT p.announcement_id FROM announcement_application_sessions s
   JOIN announcement_application_entries e ON e.token_hash=s.token_hash
   JOIN announcement_posts p ON p.announcement_id=e.announcement_id
   WHERE s.applicant_user_id=$1 AND s.expires_at>NOW() AND
    e.enabled=TRUE AND e.expires_at>NOW() AND
    p.status='published' AND p.accept_applications=TRUE
    AND (p.deadline_at IS NULL OR p.deadline_at>NOW())`,[applicantId]);
 return res.rows.length===1?{announcementId:Number(res.rows[0].announcement_id)}:null;
}

/** Compatibility for published posts that already contain old a_ Bot links.
 * Resolves ONLY an existing sent recruitment receipt to its owner. The token's
 * previously invented timeout must not stop a contact link. Read only.
 */
export async function legacyRecruitmentContactOwner(payload:string):Promise<number>{
 const match=/^a_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match)throw Error("LEGACY_RECRUITMENT_LINK_INVALID");
 const key=applicationTokenHash(match[1]!);
 const r=await pool.query(
  `SELECT DISTINCT p.owner_user_id
    FROM announcement_application_entries e
    JOIN announcement_posts p ON p.announcement_id=e.announcement_id
    JOIN posting_deliveries d ON d.source_type='announcement'
      AND d.source_id=p.announcement_id::text
    WHERE e.token_hash=$1 AND p.kind='recruitment'
      AND p.status='published' AND d.status IN ('sent','archived')
      AND d.telegram_message_id IS NOT NULL LIMIT 2`,[key]);
 const owner=r.rows.length===1?Number(r.rows[0].owner_user_id):NaN;
 if(!Number.isSafeInteger(owner)||owner<=0)throw Error("LEGACY_RECRUITMENT_OWNER_UNVERIFIED");
 return owner;
}
