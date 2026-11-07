/** Integration adapters for the existing @GayBBS_bot runtime.
 * Only call from a verified administrator release route. Never directly
 * run from startup, migration or scheduled workers.
 */
import type {Telegram} from "telegraf";
import {Input} from "telegraf";
import {pool} from "../db/index.js";
import type {OnlinePhotoStore,OnlinePhotoTarget,OnlinePhotoReceipt,OnlinePhotoSender} from "./onlineRoomPublisher.js";

const expectTarget=(target:OnlinePhotoTarget)=>{
 if(target.chatId!==-1003847210571||!Number.isSafeInteger(target.threadId)||target.threadId<=0)
  throw new Error("ONLINE_TOPIC_UNVERIFIED");
};
export const onlineRoomPhotoStore:OnlinePhotoStore={
 async claim(target){
  expectTarget(target);
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   const rows=await client.query(
    `SELECT set_id,state FROM online_room_board_sets WHERE chat_id=$1
      AND message_thread_id=$2 FOR UPDATE`,[target.chatId,target.threadId]);
   if(rows.rows.length!==1||rows.rows[0].state!=="verified")
    throw new Error("ONLINE_SET_NOT_VERIFIED_OR_RECONCILE_REQUIRED");
   const setId=Number(rows.rows[0].set_id);
   const receipts=await client.query(
    `SELECT card_key,message_id FROM online_room_board_cards WHERE set_id=$1`,[setId]);
   if(receipts.rows.length)throw new Error("ONLINE_EXISTING_RECEIPTS_RECONCILE");
   const updated=await client.query(
    `UPDATE online_room_board_sets SET state='publishing',updated_at=NOW()
     WHERE set_id=$1 AND state='verified' RETURNING set_id`,[setId]);
   if(updated.rowCount!==1)throw new Error("ONLINE_CLAIM_CONFLICT");
   await client.query("COMMIT");
   return {setId,existing:[]};
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 },
 async record(setId,receipt){
  if(!Number.isSafeInteger(receipt.messageId)||receipt.messageId<=0)throw new Error("ONLINE_INVALID_MESSAGE_ID");
  await pool.query(
   `INSERT INTO online_room_board_cards(set_id,card_key,message_id) VALUES($1,$2,$3)`,
   [setId,receipt.key,receipt.messageId]);
 },
 async finish(setId){
  const all=await pool.query(
   `SELECT card_key FROM online_room_board_cards WHERE set_id=$1`,[setId]);
  if(all.rows.length!==4||new Set(all.rows.map(x=>x.card_key)).size!==4)
   throw new Error("ONLINE_CARD_SET_INCOMPLETE");
  const r=await pool.query(
   `UPDATE online_room_board_sets SET state='published',revision=revision+1,
      updated_at=NOW() WHERE set_id=$1 AND state='publishing' RETURNING set_id`,[setId]);
  if(r.rowCount!==1)throw new Error("ONLINE_FINISH_CONFLICT");
 },
 async reconcile(setId){
  await pool.query(
   `UPDATE online_room_board_sets SET state='needs_reconcile',updated_at=NOW()
     WHERE set_id=$1 AND state='publishing'`,[setId]);
 },
};
export function onlineRoomPhotoSender(telegram:Telegram):OnlinePhotoSender{
 return async({target,card,media})=>{
  expectTarget(target);
  if(!Buffer.isBuffer(media.bytes)||!media.bytes.length)
   throw new Error("ONLINE_MEDIA_INVALID");
  const sent=await telegram.sendPhoto(target.chatId,
   Input.fromBuffer(media.bytes,card.image.filename),{
    message_thread_id:target.threadId,
    caption:card.caption,
    reply_markup:{inline_keyboard:[[{text:card.button.text,url:card.button.url}]]},
   });
  return sent.message_id;
 };
}
/** Runtime media bytes are provided by the existing authorized Drive asset
 * transport. Do not download from public Drive share links or use File IDs
 * as Telegram file IDs. No automatic send is attached to Bot startup.
 */
