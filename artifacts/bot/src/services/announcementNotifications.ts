/** Announcement-owned DM notification outbox; one irreversible Telegram send per
 * claimed event. Unknown outcomes NEVER go back to pending automatically.
 */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";

type EventPayload={source?:string;applicationId?:number;action?:string;kind?:string;roomId?:number};
export function renderAnnouncementNotification(payload:EventPayload):string{
 // Source type is informational. Only an allowlisted action is rendered.
 const action=String(payload.action||payload.kind||"");
 const label:Record<string,string>={
  submitted:"📨 新しい応募が届きました。/applications で確認できます。",
  accepted:"✅ 応募が承認されました。/myapplications で確認できます。",
  held:"⏸ 応募が保留されました。/myapplications で確認できます。",
  declined:"❌ 応募が見送られました。/myapplications で確認できます。",
  cancelled:"❌ ROOM開催が中止されました。/myapplications または /myrooms で確認できます。",
  finished:"■ ROOMの終了が申告されました。",
  postponed:"⏸ ROOMの延期が申告されました。",
  started:"🔴 ROOMはLIVE中です。事前応募したROOMが始まりました。承認済みの場合は /joinrooms から参加できます。",
  prepared:"✅ ROOMホストの準備が完了しました。",
  scheduled:"📅 ROOMの開催予定が更新されました。",
  scheduled_due:"📅 予告ROOMの開催予定時刻です。開始する場合は /myrooms で［開始する］を押してください。",
  visibility_changed:"🔐 ROOMの参加方式が変更されました。/myrooms で確認できます。",
 };
 const value=label[action];
 if(!value)throw new Error("NOTIFICATION_ACTION_NOT_SUPPORTED");
 return value; // no room URL, full profile, Telegram ID or untrusted user text
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
  const message=renderAnnouncementNotification(row.payload as EventPayload);
  await telegram.sendMessage(userId,message);
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
