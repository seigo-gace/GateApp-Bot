/** PostgreSQL-backed state for the @GayBBS_bot admission module.
 * Existing targets, approvals, invite_links and gate_sessions remain authoritative.
 * All user progression is compare-and-swap; never use in-memory admission state.
 */
import {randomUUID} from "node:crypto";
import {pool} from "../../db/index.js";
import type {PoolClient} from "pg";
import {ADMISSION_VERSION, type ConsentStage} from "./contract.js";

export type GateAttempt = {
 tg_user_id:string; target_id:number; step:string; step_token:string|null;
 challenge_fails:number; challenge_data:unknown; last_message_id:number|null;
 attempt_id:string; document_version:string; last_attempt:Date|null;
 updated_at:Date;
};
const active = new Set(["intro","challenge","q1","q2","rules","issuing"]);
export async function readAttempt(userId:number):Promise<GateAttempt|undefined>{
 const r=await pool.query<GateAttempt>("SELECT * FROM gate_sessions WHERE tg_user_id=$1",[userId]);
 return r.rows[0];
}
export async function openAttempt(userId:number,targetId:number,token:string):Promise<{attempt:GateAttempt;existing:boolean}>{
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const old=(await c.query<GateAttempt>("SELECT * FROM gate_sessions WHERE tg_user_id=$1 FOR UPDATE",[userId])).rows[0];
  if(old && active.has(old.step) && old.updated_at.getTime()>Date.now()-24*3600_000){
   if(old.target_id!==targetId)throw new Error("GATE_ANOTHER_TARGET_ACTIVE");
   await c.query("COMMIT");
   return {attempt:old,existing:true};
  }
  // An already approved invitation is not silently replaced by another attempt.
  if(old && old.step==="approved" && old.updated_at.getTime()>Date.now()-24*3600_000 &&
     old.target_id===targetId){
   await c.query("COMMIT");
   return {attempt:old,existing:true};
  }
  const attemptId=randomUUID();
  await c.query(`INSERT INTO approvals
   (target_id,tg_user_id,status,attempt_id,document_version)
   VALUES ($1,$2,'pending',$3,$4)`,[targetId,userId,attemptId,ADMISSION_VERSION]);
  const r=await c.query<GateAttempt>(`INSERT INTO gate_sessions
   (tg_user_id,target_id,step,step_token,attempt_id,document_version,challenge_fails,challenge_data,last_message_id,last_attempt)
   VALUES ($1,$2,'intro',$3,$4,$5,0,NULL,NULL,NOW())
   ON CONFLICT (tg_user_id) DO UPDATE SET
   target_id=EXCLUDED.target_id,step='intro',step_token=EXCLUDED.step_token,
   attempt_id=EXCLUDED.attempt_id,document_version=EXCLUDED.document_version,
   challenge_fails=0,challenge_data=NULL,last_message_id=NULL,
   last_attempt=NOW(),updated_at=NOW() RETURNING *`,
   [userId,targetId,token,attemptId,ADMISSION_VERSION]);
  await c.query("COMMIT");
  return {attempt:r.rows[0]!,existing:false};
 }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
}
export async function rememberScreen(attempt:GateAttempt,messageId:number):Promise<boolean>{
 const r=await pool.query(`UPDATE gate_sessions SET last_message_id=$1,updated_at=NOW()
 WHERE tg_user_id=$2 AND target_id=$3 AND attempt_id=$4 AND step=$5 AND step_token=$6`,
 [messageId,attempt.tg_user_id,attempt.target_id,attempt.attempt_id,attempt.step,attempt.step_token]);
 return r.rowCount===1;
}
export async function transition(args:{
 attempt:GateAttempt;messageId:number;next:string;newToken:string;
 fails?:number;challengeData?:unknown;consent?:{stage:ConsentStage;accepted:boolean}
}):Promise<boolean>{
 const {attempt:a}=args;
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const r=await c.query(`UPDATE gate_sessions SET step=$1,step_token=$2,
   challenge_fails=$3,challenge_data=$4,updated_at=NOW()
   WHERE tg_user_id=$5 AND target_id=$6 AND attempt_id=$7
   AND step=$8 AND step_token=$9 AND last_message_id=$10`,
   [args.next,args.newToken,args.fails??a.challenge_fails,args.challengeData??null,
    a.tg_user_id,a.target_id,a.attempt_id,a.step,a.step_token,args.messageId]);
  if(r.rowCount!==1){await c.query("ROLLBACK");return false}
  if(args.consent){
   await c.query(`INSERT INTO gate_consents
     (target_id,tg_user_id,attempt_id,stage,document_version,accepted)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
     [a.target_id,a.tg_user_id,a.attempt_id,args.consent.stage,
      a.document_version,args.consent.accepted]);
  }
  if(args.next==="rejected"){
   await c.query(`UPDATE approvals SET status='rejected',rejected_reason='本人が拒否または確認失敗',updated_at=NOW()
    WHERE target_id=$1 AND tg_user_id=$2 AND attempt_id=$3 AND status='pending'`,
    [a.target_id,a.tg_user_id,a.attempt_id]);
  }
  await c.query("COMMIT");return true;
 }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
}
export async function consentsComplete(a:GateAttempt):Promise<boolean>{
 const r=await pool.query(`SELECT COUNT(DISTINCT stage)::int AS n FROM gate_consents
  WHERE target_id=$1 AND tg_user_id=$2 AND attempt_id=$3
  AND document_version=$4 AND accepted=TRUE AND stage IN ('question1','question2','rules')`,
  [a.target_id,a.tg_user_id,a.attempt_id,a.document_version]);
 return r.rows[0]?.n===3;
}
export async function saveIssuedInvite(a:GateAttempt,link:string,expires:Date):Promise<boolean>{
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const session=await c.query(`UPDATE gate_sessions SET step='approved',updated_at=NOW()
   WHERE tg_user_id=$1 AND target_id=$2 AND attempt_id=$3 AND step='issuing'
   RETURNING tg_user_id`,[a.tg_user_id,a.target_id,a.attempt_id]);
  if(session.rowCount!==1){await c.query("ROLLBACK");return false}
  const check=await c.query(`SELECT COUNT(DISTINCT stage)::int AS n FROM gate_consents
    WHERE target_id=$1 AND tg_user_id=$2 AND attempt_id=$3
      AND document_version=$4 AND accepted=true`,
    [a.target_id,a.tg_user_id,a.attempt_id,a.document_version]);
  if(check.rows[0]?.n!==3){await c.query("ROLLBACK");return false}
  await c.query(`INSERT INTO invite_links
   (target_id,tg_user_id,invite_link,expire_at,attempt_id)
   VALUES ($1,$2,$3,$4,$5)`,
   [a.target_id,a.tg_user_id,link,expires,a.attempt_id]);
  const approval=await c.query(`UPDATE approvals SET status='approved',approved_at=NOW(),updated_at=NOW()
   WHERE target_id=$1 AND tg_user_id=$2 AND attempt_id=$3 AND status='pending'`,
   [a.target_id,a.tg_user_id,a.attempt_id]);
  if(approval.rowCount!==1){await c.query("ROLLBACK");return false}
  await c.query("COMMIT");return true;
 }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
}
export async function currentIssuedInvite(a:GateAttempt):Promise<string|null>{
 const r=await pool.query(`SELECT invite_link FROM invite_links
  WHERE target_id=$1 AND tg_user_id=$2 AND attempt_id=$3
    AND used_at IS NULL AND revoked_at IS NULL AND expire_at>NOW()
  ORDER BY created_at DESC LIMIT 1`,[a.target_id,a.tg_user_id,a.attempt_id]);
 return r.rows[0]?.invite_link??null;
}
export async function verifiedApprovalDocumentLinks(chatId:number):Promise<Record<string,string>|null>{
 // Existing verified-link registry only: don't fabricate URLs or silently publish draft policies.
 const r=await pool.query(`SELECT link_key,destination_url FROM general_guide_links
   WHERE chat_id=$1 AND enabled=true AND verified_by IS NOT NULL AND verified_at IS NOT NULL
     AND link_key=ANY($2::text[])`,
   [chatId,["guideline","terms","privacy","rules"]]);
 const links:Record<string,string>={};
 for(const row of r.rows){links[row.link_key]=row.destination_url}
 return Object.keys(links).length===4?links:null;
}
export async function getRequestEligibility(client:PoolClient,args:{
 targetId:number;userId:number;url:string
}):Promise<{allowed:boolean;inviteId:number|null;reason:string}>{
 const r=await client.query(`SELECT i.invite_id,i.target_id,i.tg_user_id,
   i.attempt_id,i.expire_at,i.used_at,i.revoked_at,
   a.status, a.document_version,
   s.step AS session_step,s.attempt_id AS session_attempt,s.document_version AS session_version
   FROM invite_links i
   JOIN approvals a ON a.target_id=i.target_id AND a.tg_user_id=i.tg_user_id
     AND a.attempt_id=i.attempt_id
   LEFT JOIN gate_sessions s ON s.tg_user_id=i.tg_user_id AND s.target_id=i.target_id
   WHERE i.target_id=$1 AND i.tg_user_id=$2 AND i.invite_link=$3
   FOR UPDATE OF i`,[args.targetId,args.userId,args.url]);
 if(r.rowCount!==1)return {allowed:false,inviteId:null,reason:"invite_mismatch"};
 const row=r.rows[0];
 if(row.used_at || row.revoked_at || new Date(row.expire_at).getTime()<=Date.now() ||
  row.status!=="approved" || row.session_step!=="approved" ||
  row.session_attempt!==row.attempt_id || row.session_version!==row.document_version)
  return {allowed:false,inviteId:null,reason:"approval_or_invite_expired"};
 const cons=await client.query(`SELECT COUNT(DISTINCT stage)::int AS n FROM gate_consents
  WHERE target_id=$1 AND tg_user_id=$2 AND attempt_id=$3 AND document_version=$4
   AND accepted=true AND stage IN ('question1','question2','rules')`,
  [args.targetId,args.userId,row.attempt_id,row.document_version]);
 if(cons.rows[0]?.n!==3)return {allowed:false,inviteId:null,reason:"consent_incomplete"};
 return {allowed:true,inviteId:Number(row.invite_id),reason:"valid"};
}
export async function withAdmissionClient<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T>{
 const c=await pool.connect();try{return await fn(c)}finally{c.release()}
}
