/** Transport cleanup is separate from DB disposal.
 * A request is put in needs_reconcile BEFORE calling Telegram. If a process
 * dies or a network result is ambiguous, it is never automatically retried.
 * Only a confirmed Telegram delete ACK may mark the receipt 'deleted',
 * after which the disposable source and IDs may be purged.
 */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";

export async function deleteNextTerminalAnnouncementMessage(
 telegram:Telegram
):Promise<{deliveryId:number;outcome:"deleted"|"needs_reconcile"}|null>{
 if(process.env.GAYBBS_TELEGRAM_DELETE_WORKER_ENABLED!=="enabled")
  throw new Error("TELEGRAM_DELETE_NOT_RELEASED");
 const gate=await pool.query(
  `SELECT 1 FROM gaybbs_feature_release_gates
   WHERE feature='announcement' AND enabled=TRUE
     AND length(source_commit)=40
     AND length(trim(ci_evidence))>0
     AND length(trim(gserver_runtime_evidence))>0
     AND length(trim(telegram_e2e_evidence))>0`);
 if(gate.rows.length!==1)throw new Error("ANNOUNCEMENT_RELEASE_NOT_VERIFIED");
 const client=await pool.connect();
 let entry:{deliveryId:number;chatId:number;messageId:number}|null=null;
 try{
  await client.query("BEGIN");
  const found=await client.query(
   `SELECT d.delivery_id,t.chat_id,d.telegram_message_id
    FROM posting_deliveries d
    JOIN posting_topics t ON t.topic_id=d.posting_topic_id
    JOIN announcement_posts a ON a.announcement_id::text=d.source_id
   WHERE d.source_type='announcement' AND d.status='sent'
     AND d.telegram_message_id IS NOT NULL
     AND a.room_id IS NULL
     AND (a.status IN ('closed','cancelled','finished')
       OR (a.expires_at IS NOT NULL AND a.expires_at<=NOW()))
   ORDER BY d.delivery_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`);
  if(found.rows.length===0){
   await client.query("COMMIT");return null;
  }
  const row=found.rows[0];
  const deliveryId=Number(row.delivery_id);
  const chatId=Number(row.chat_id);
  const messageId=Number(row.telegram_message_id);
  if(!Number.isSafeInteger(deliveryId)||deliveryId<=0||
     !Number.isSafeInteger(chatId)||chatId>=0||
     !Number.isSafeInteger(messageId)||messageId<=0)
   throw new Error("TELEGRAM_DELETE_RECEIPT_INVALID");
  // Precommit uncertain-state marker prevents duplicate destructive sends.
  const marked=await client.query(
   `UPDATE posting_deliveries SET status='needs_reconcile',
     updated_at=NOW() WHERE delivery_id=$1 AND status='sent'
     RETURNING delivery_id`,[deliveryId]);
  if(marked.rows.length!==1)throw new Error("TELEGRAM_DELETE_CLAIM_LOST");
  entry={deliveryId,chatId,messageId};
  await client.query("COMMIT");
 }catch(error){await client.query("ROLLBACK");throw error;}
 finally{client.release();}
 if(!entry)return null;
 try{
  await telegram.deleteMessage(entry.chatId,entry.messageId);
  const ack=await pool.query(
   `UPDATE posting_deliveries SET status='deleted',updated_at=NOW()
      WHERE delivery_id=$1 AND status='needs_reconcile'
        AND telegram_message_id=$2 RETURNING delivery_id`,
   [entry.deliveryId,entry.messageId]);
  if(ack.rows.length!==1)throw new Error("TELEGRAM_DELETE_ACK_UNCERTAIN");
  return {deliveryId:entry.deliveryId,outcome:"deleted"};
 }catch{
  // Cannot distinguish Telegram API refusal, timeout, or DB ACK failure.
  // Keep the receipt for human/source-of-truth reconciliation; no retry.
  return {deliveryId:entry.deliveryId,outcome:"needs_reconcile"};
 }
}
