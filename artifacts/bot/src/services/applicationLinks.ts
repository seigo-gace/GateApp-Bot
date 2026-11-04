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
export async function activateApplicationSession(
 applicantId:number,payload:string
):Promise<{announcementId:number;body:string}>{
 const match=/^a_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match||!Number.isSafeInteger(applicantId)||applicantId<=0)
  throw new Error("APPLICATION_LINK_INVALID");
 const key=applicationTokenHash(match[1]!);
 const res=await pool.query(
  `SELECT p.announcement_id,p.text,p.owner_user_id,p.kind,p.status,
          p.accept_applications,p.deadline_at
   FROM announcement_application_entries e
   JOIN announcement_posts p ON p.announcement_id=e.announcement_id
   WHERE e.token_hash=$1 AND e.enabled=TRUE AND e.expires_at>NOW()`,[key]);
 if(res.rows.length!==1)throw new Error("APPLICATION_LINK_EXPIRED");
 const p=res.rows[0];
 if(p.kind!=="recruitment"||Number(p.owner_user_id)===applicantId)
  throw new Error("SELF_APPLICATION_REFUSED");
 if(p.status!=="published"||p.accept_applications!==true||
    (p.deadline_at&&new Date(p.deadline_at).getTime()<=Date.now()))
  throw new Error("APPLICATIONS_CLOSED");
 await pool.query(
  `INSERT INTO announcement_application_sessions(applicant_user_id,token_hash,expires_at)
   VALUES($1,$2,NOW()+INTERVAL '24 hours')
   ON CONFLICT(applicant_user_id) DO UPDATE SET
    token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,created_at=NOW()`,
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
