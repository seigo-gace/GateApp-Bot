/** History-preserving terminal Announcement/Recruitment cleanup.
 * Keep original Telegram messages (do not call deleteMessage); remove their
 * live action buttons, change the visible status, then allow DB disposal.
 * Explicitly requested post deletion uses a separate owner-authorized flow.
 */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
export type AnnouncementArchiveState="closed"|"cancelled"|"finished"|"expired";
export function archiveAnnouncementText(original:string,kind:string,state:AnnouncementArchiveState):string{
 if(!original.trim()||original.length>3700)throw new Error("ARCHIVE_BODY_INVALID");
 const label=state==="cancelled"?"🚫 中止":kind==="recruitment"?"✅ 募集終了":"📌 掲載終了";
 const base=original.replace(/^状態：[^\r\n]*$/mu,"").trimEnd();
 const text=base+"\n状態："+label;
 if(text.length>4096)throw new Error("ARCHIVE_BODY_TOO_LONG");
 return text;
}
export async function archiveNextTerminalAnnouncement(telegram:Telegram):Promise<{
 deliveryId:number;status:"archived"|"needs_reconcile";
}|null>{
 if(process.env.GAYBBS_ANNOUNCEMENT_ARCHIVE_ENABLED!=="enabled")
  throw new Error("ANNOUNCEMENT_ARCHIVE_NOT_RELEASED");
 const gate=await pool.query(
  `SELECT 1 FROM gaybbs_feature_release_gates
     WHERE feature='announcement' AND enabled=TRUE
       AND length(source_commit)=40
       AND length(trim(ci_evidence))>0
       AND length(trim(gserver_runtime_evidence))>0
       AND length(trim(telegram_e2e_evidence))>0`);
 if(gate.rows.length!==1)throw new Error("ANNOUNCEMENT_ARCHIVE_GATE_UNVERIFIED");
 const client=await pool.connect();
 let job:null|{id:number;chatId:number;messageId:number;text:string;
  kind:string;state:AnnouncementArchiveState}=null;
 try{
  await client.query("BEGIN");
  const result=await client.query(
   `SELECT d.delivery_id,t.chat_id,d.telegram_message_id,d.rendered_text,a.kind,
           a.status,a.expires_at
      FROM posting_deliveries d
      JOIN posting_topics t ON t.topic_id=d.posting_topic_id
      JOIN announcement_posts a ON a.announcement_id::text=d.source_id
     WHERE d.source_type='announcement' AND d.status='sent'
       AND d.telegram_message_id IS NOT NULL AND t.enabled=TRUE
       AND a.room_id IS NULL AND a.expiry_action='close'
       -- Recruitment has no Master-approved automatic close/expiry policy.
       AND a.kind <> 'recruitment'
       AND (a.status IN ('closed','cancelled','finished')
         OR (a.expires_at IS NOT NULL AND a.expires_at<=NOW()))
     ORDER BY d.delivery_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`);
  if(!result.rows.length){await client.query("COMMIT");return null;}
  const row=result.rows[0];
  const id=Number(row.delivery_id),chatId=Number(row.chat_id),
   messageId=Number(row.telegram_message_id);
  if(!Number.isSafeInteger(id)||id<=0||
     !Number.isSafeInteger(chatId)||chatId>=0||
     !Number.isSafeInteger(messageId)||messageId<=0)
   throw new Error("ANNOUNCEMENT_ARCHIVE_RECEIPT_INVALID");
  if(row.rendered_text===null){
   await client.query(
    "UPDATE posting_deliveries SET status='needs_reconcile',updated_at=NOW() WHERE delivery_id=$1 AND status='sent'",
    [id]);
   await client.query("COMMIT");
   return {deliveryId:id,status:"needs_reconcile"};
  }
  job={id,chatId,messageId,text:String(row.rendered_text),kind:String(row.kind),
   state:row.status==="cancelled"?"cancelled":
    row.status==="closed"?"closed":row.status==="finished"?"finished":"expired"};
  await client.query(
   `UPDATE posting_deliveries SET status='needs_reconcile',updated_at=NOW()
    WHERE delivery_id=$1 AND status='sent'`,[id]);
  await client.query("COMMIT");
 }catch(e){await client.query("ROLLBACK");throw e;}
 finally{client.release();}
 if(!job)return null;
 try{
  await telegram.editMessageText(job.chatId,job.messageId,undefined,
   archiveAnnouncementText(job.text,job.kind,job.state),{
    parse_mode:"HTML",
    reply_markup:{inline_keyboard:[]},
   });
  const ack=await pool.query(
   `UPDATE posting_deliveries SET status='archived',inline_buttons=NULL,
      updated_at=NOW() WHERE delivery_id=$1 AND status='needs_reconcile'
    RETURNING delivery_id`,[job.id]);
  if(ack.rows.length!==1)throw new Error("ARCHIVE_ACK_UNCERTAIN");
  return {deliveryId:job.id,status:"archived"};
 }catch{
  // Telegram may have accepted the edit. Keep message ID for reconciliation;
  // never send duplicates or erase the last handle.
  return {deliveryId:job.id,status:"needs_reconcile"};
 }
}
