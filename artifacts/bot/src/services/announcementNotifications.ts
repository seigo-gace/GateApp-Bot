/** Announcement-owned DM notification outbox; one irreversible Telegram send per
 * claimed event. Unknown outcomes NEVER go back to pending automatically.
 */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {Markup} from "telegraf";
import {renderRoomApplicantSummary} from "./announcementApplications.js";
import {applicantDmLink} from "./telegramUsernameLink.js";
import {adaptiveChoiceRows} from "./inlineSelection.js";

type EventPayload={source?:string;applicationId?:number;action?:string;kind?:string;roomId?:number};
export function renderAnnouncementNotification(payload:EventPayload):string{
 // Source type is informational. Only an allowlisted action is rendered.
 const action=String(payload.action||payload.kind||"");
 const label:Record<string,string>={
  submitted:"📨 新しい応募が届きました。下のボタンから確認できます。",
  accepted:"✅ 応募が承認されました。下のボタンから参加状況を確認できます。",
  held:"⏸ 応募が保留されました。主催者の連絡をお待ちください。",
  declined:"❌ 応募が見送られました。",
  cancelled:"❌ ROOM開催が中止されました。",
  finished:"■ ROOMの終了が申告されました。",
  postponed:"⏸ ROOMの延期が申告されました。",
  started:"🔴 ROOMが開始されました。参加許可のある方は下のボタンから参加できます。",
  prepared:"✅ ROOMホストの準備が完了しました。",
  scheduled:"📅 ROOMの開催予定が更新されました。",
  visibility_changed:"🔐 ROOMの参加方式が変更されました。",
 };
 const value=label[action];
 if(!value)throw new Error("NOTIFICATION_ACTION_NOT_SUPPORTED");
 return value; // no room URL, full profile, Telegram ID or untrusted user text
}
/** Owner's direct applicant DM + accept / reject share the adopted layout. */
export function roomApplicantNotificationKeyboard(
 applicantId:number,applicationId:number,username?:unknown,
){
 if(!Number.isSafeInteger(applicationId)||applicationId<=0)
  throw Error("ROOM_APPLICATION_NOTIFICATION_ID_INVALID");
 const actions=[
  Markup.button.url("💬 応募者へDM",applicantDmLink(applicantId,username)),
  Markup.button.callback("✅ 承諾",`application:decide:${applicationId}:accepted`),
  Markup.button.callback("❌ 拒否",`application:decide:${applicationId}:declined`),
 ];
 return Markup.inlineKeyboard(adaptiveChoiceRows(actions));
}
export async function deliverNextAnnouncementNotification(telegram:Telegram):Promise<{
 id:number;state:"sent"|"needs_reconcile";
}|null>{
 if(process.env.GAYBBS_NOTIFICATION_DELIVERY_ENABLED!=="enabled")
  throw new Error("ANNOUNCEMENT_NOTIFICATION_DELIVERY_LOCKED");
 const approved=await pool.query(
  `SELECT 1 FROM gaybbs_feature_release_gates WHERE feature='announcement'
   AND enabled=TRUE AND length(source_commit)=40
   AND length(trim(ci_evidence))>0
   AND length(trim(gserver_runtime_evidence))>0
   AND length(trim(telegram_e2e_evidence))>0
   AND approved_by IS NOT NULL`);
 if(approved.rows.length!==1)throw new Error("ANNOUNCEMENT_RELEASE_NOT_VERIFIED");
 const found=await pool.query(
  `WITH candidate AS (
    SELECT notification_id FROM announcement_notifications WHERE state='pending'
    ORDER BY notification_id LIMIT 1 FOR UPDATE SKIP LOCKED
  ) UPDATE announcement_notifications n SET state='sending'
   FROM candidate WHERE n.notification_id=candidate.notification_id
   RETURNING n.notification_id,n.recipient_user_id,n.payload`);
 if(found.rows.length===0)return null;
 const row=found.rows[0], id=Number(row.notification_id);
 try{
  const userId=Number(row.recipient_user_id);
  if(!Number.isSafeInteger(userId)||userId<=0)
   throw new Error("NOTIFICATION_USER_INVALID");
  const payload=row.payload as EventPayload;
  let message=renderAnnouncementNotification(payload);
  let extra:ReturnType<typeof Markup.inlineKeyboard>|undefined;
  let useHtml=false;
  if(payload.action==="submitted"&&Number.isSafeInteger(payload.applicationId)&&Number(payload.applicationId)>0){
   const entry=await pool.query(
    `SELECT ap.consented_profile,ap.applicant_user_id,p.room_id
       FROM announcement_applications ap
       JOIN announcement_posts p ON p.announcement_id=ap.announcement_id
       WHERE ap.application_id=$1 AND p.owner_user_id=$2`,
    [payload.applicationId,userId]);
   if(entry.rows.length!==1)throw Error("ROOM_APPLICATION_NOTIFICATION_NOT_OWNED");
   if(entry.rows[0].room_id!==null){
    message=renderRoomApplicantSummary(entry.rows[0].consented_profile as Record<string,unknown>|null);
    const applicantId=Number(entry.rows[0].applicant_user_id);
    if(!Number.isSafeInteger(applicantId)||applicantId<=0)
     throw Error("ROOM_APPLICANT_ID_INVALID");
    let username:unknown;
    try{
     const chat=await telegram.getChat(applicantId);
     username="username" in chat?chat.username:undefined;
    }catch{
     // Applicant already contacted the bot to submit. Keep the ID link
     // available even when getChat fails or no public username is set.
    }
    extra=roomApplicantNotificationKeyboard(
     applicantId,Number(payload.applicationId),username);
    useHtml=true;
   }
  }
  if(payload.action==="accepted"&&Number.isSafeInteger(payload.applicationId)&&Number(payload.applicationId)>0){
   const linked=await pool.query(
    `SELECT p.room_id FROM announcement_applications ap
       JOIN announcement_posts p ON p.announcement_id=ap.announcement_id
       WHERE ap.application_id=$1 AND ap.applicant_user_id=$2
         AND ap.status='accepted' AND p.room_id IS NOT NULL`,
    [payload.applicationId,userId]);
   if(linked.rows.length===1){
    extra=Markup.inlineKeyboard([[
     Markup.button.callback("🔗 ROOMへ参加",`room:join:${Number(linked.rows[0].room_id)}`)
    ]]);
   }
  }
  if(payload.action==="started"&&Number.isSafeInteger(payload.roomId)&&Number(payload.roomId)>0){
   extra=Markup.inlineKeyboard([[
    Markup.button.callback("🔗 ROOMへ参加",`room:join:${payload.roomId}`)
   ]]);
  }
  await telegram.sendMessage(userId,message,
   useHtml?{parse_mode:"HTML",...extra}:extra);
  const ack=await pool.query(
   `UPDATE announcement_notifications SET state='sent',sent_at=NOW()
     WHERE notification_id=$1 AND state='sending' RETURNING notification_id`,[id]);
  if(ack.rows.length!==1)throw new Error("NOTIFICATION_ACK_UNCERTAIN");
  return {id,state:"sent"};
 }catch{
  // Telegram may have accepted it even when network/DB acknowledgment failed.
  await pool.query(
   `UPDATE announcement_notifications SET state='needs_reconcile'
    WHERE notification_id=$1 AND state='sending'`,[id]);
  return {id,state:"needs_reconcile"};
 }
}
