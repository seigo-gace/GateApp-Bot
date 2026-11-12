import { pool } from "../db/index.js";
import { assertVerifiedTopic, type PostPurpose, type VerifiedTopic } from "./topicRouting.js";

function fromRow(r:Record<string,unknown>):VerifiedTopic {
 return {
   id:Number(r.topic_id), board:r.board_key as VerifiedTopic["board"],
   purpose:r.purpose as PostPurpose, chatId:Number(r.chat_id),
   threadId:Number(r.message_thread_id), title:String(r.title),
   verifiedAt:new Date(String(r.verified_at)), enabled:r.enabled===true,
 };
}
export async function listVerifiedTopics(purpose:PostPurpose):Promise<VerifiedTopic[]> {
 const r=await pool.query(
  "SELECT * FROM posting_topics WHERE purpose=$1 AND enabled=TRUE AND verified_at IS NOT NULL AND verified_by IS NOT NULL ORDER BY board_key,title,topic_id",
  [purpose]
 );
 return r.rows.map(row=>{const t=fromRow(row);return assertVerifiedTopic(t,t.board,purpose);});
}
export async function getVerifiedTopic(id:number,purpose:PostPurpose):Promise<VerifiedTopic> {
 if(!Number.isSafeInteger(id)||id<=0)throw new Error("TOPIC_NOT_VERIFIED");
 const r=await pool.query(
  "SELECT * FROM posting_topics WHERE topic_id=$1 AND purpose=$2 AND enabled=TRUE AND verified_at IS NOT NULL AND verified_by IS NOT NULL",
  [id,purpose]
 );
 if(r.rows.length!==1)throw new Error("TOPIC_NOT_VERIFIED");
 const t=fromRow(r.rows[0]);
 return assertVerifiedTopic(t,t.board,purpose);
}
/** The existing GateApp verified posting_topics DB is the sole source of
 * live sticker Topic IDs. The public t.me/c message URL is never a thread ID.
 * Multiple rows are an error, not a broadcast or arbitrary first-choice.
 */
export async function getVerifiedStickerTopic():Promise<{
 id:number;board:"video_chat";purpose:"sticker";chatId:number;threadId:number;
 title:string;groupTitle:string;enabled:true;verified:true;verifiedAt:Date
}> {
 const r=await pool.query(
  "SELECT * FROM posting_topics WHERE board_key='video_chat' AND purpose='sticker'"+
  " AND title=$1 AND enabled=TRUE AND verified_at IS NOT NULL"+
  " AND verified_by IS NOT NULL ORDER BY topic_id LIMIT 2",
  ["ステッカーの公開と販売"]
 );
 if(r.rows.length!==1)throw new Error("STICKER_TOPIC_NOT_VERIFIED_OR_AMBIGUOUS");
 const t=fromRow(r.rows[0]);
 const verified=assertVerifiedTopic(t,"video_chat","sticker");
 if(verified.title!=="ステッカーの公開と販売"||
    verified.chatId!==-1002373696859)
   throw new Error("STICKER_TOPIC_OWNER_MISMATCH");
 return {...verified,board:"video_chat",purpose:"sticker",
  groupTitle:"ビデオChatの掲示板",enabled:true,verified:true};
}
export type DeliveryState={id:number,status:string,messageId:number|null};
export async function claimDelivery(
 sourceType:PostPurpose,sourceId:string,ownerId:number,revision:number,topicId:number,
 buttons:readonly (readonly {text:string;url:string}[])[]=[]
):Promise<{claimed:boolean;delivery:DeliveryState}> {
 if(!Number.isSafeInteger(ownerId)||ownerId<=0||!Number.isSafeInteger(revision)||revision<=0)
   throw new Error("DELIVERY_INVALID");
 const op=`${sourceType}:${sourceId}:${revision}:${topicId}`;
 const cx=await pool.connect();
 try{
  await cx.query("BEGIN");
  const existing=await cx.query(
   "INSERT INTO posting_deliveries (source_type,source_id,owner_user_id,source_revision,posting_topic_id,operation_key,status,inline_buttons) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7::jsonb) ON CONFLICT (operation_key) DO NOTHING RETURNING delivery_id,status,telegram_message_id",
   [sourceType,sourceId,ownerId,revision,topicId,op,JSON.stringify(buttons)]
  );
  let claimed=false;
  const claimedRow=await cx.query(
   "UPDATE posting_deliveries SET status='sending',updated_at=NOW() WHERE operation_key=$1 AND status='pending' AND owner_user_id=$2 RETURNING delivery_id,status,telegram_message_id",
   [op,ownerId]
  );
  if(claimedRow.rows.length===1)claimed=true;
  const row=claimedRow.rows[0]??(await cx.query(
   "SELECT delivery_id,status,telegram_message_id FROM posting_deliveries WHERE operation_key=$1 AND owner_user_id=$2",
   [op,ownerId])).rows[0];
  if(!row)throw new Error("DELIVERY_OWNER_MISMATCH");
  await cx.query("COMMIT");
  return {claimed,delivery:{id:Number(row.delivery_id),status:row.status,
   messageId:row.telegram_message_id===null?null:Number(row.telegram_message_id)}};
 }catch(e){await cx.query("ROLLBACK");throw e;}finally{cx.release();}
}
export async function acknowledgeDelivery(id:number,messageId:number,renderedText:string):Promise<void>{
 if(!renderedText.trim()||renderedText.length>4096)throw new Error("MESSAGE_TEXT_INVALID");
 if(!Number.isSafeInteger(messageId)||messageId<=0)throw new Error("MESSAGE_ID_INVALID");
 const cx=await pool.connect();
 try{
  await cx.query("BEGIN");
  const update=await cx.query(
   "UPDATE posting_deliveries SET status='sent',telegram_message_id=$2,rendered_text=$3,updated_at=NOW() WHERE delivery_id=$1 AND status='sending' RETURNING delivery_id",
   [id,messageId,renderedText]
  );
  if(update.rows.length!==1)throw new Error("DELIVERY_STALE");
  // MPB owns delivery only. Source-specific profile/ROOM/announcement state
  // must be updated by their owning module after the delivery receipt.
  await cx.query("COMMIT");
 }catch(e){await cx.query("ROLLBACK");throw e;}finally{cx.release();}
}
export async function markDeliveryUnknown(id:number):Promise<void>{
 await pool.query(
  "UPDATE posting_deliveries SET status='needs_reconcile',updated_at=NOW() WHERE delivery_id=$1 AND status='sending'",[id]
 );
}
