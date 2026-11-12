/** Existing Telegram ROOM announcement remains in the group after meeting.
 * The temporary ROOM database may be purged only after confirmed edits.
 * Never include the private meeting URL in public status text.
 */
import type {Telegram} from "telegraf";
import {Markup} from "telegraf";
import {pool} from "../db/index.js";

export type PublicRoomStatus="scheduled"|"prepared"|"started"|"postponed"|
 "cancelled"|"finished"|"visibility_changed"|"details_changed";

export function roomBadge(kind:PublicRoomStatus):string{
 const badges:Record<PublicRoomStatus,string>={
  scheduled:"📅 予告中",
  prepared:"🟢 準備完了",
  started:"🔴 LIVE中",
  postponed:"⏸ 延期",
  cancelled:"🚫 中止",
  finished:"✅ 終了",
  visibility_changed:"🔒 参加条件を更新しました",
  details_changed:"📝 募集内容を更新しました",
 };
 if(!(kind in badges))throw new Error("ROOM_BADGE_UNRECOGNIZED");
 return badges[kind];
}
export function roomStatusMessage(original:string,kind:PublicRoomStatus,
 details?:{title:string;description:string}):string{
 if(!original.trim()||original.length>3700)
  throw new Error("ROOM_STATUS_TEXT_INVALID");
 // ROOM meeting links belong solely in authorized DM, not in a public post.
 if(/https?:\/\/[^\s"'<>]*\/(?:GayBBS-|PRIVATE_)/i.test(original))
  throw new Error("ROOM_PRIVATE_LINK_PUBLIC_REFUSED");
 const badge=roomBadge(kind);
 let base=original.replace(/^状態：[^\r\n]*/mu,"").trimEnd();
 if(kind==="details_changed"){
  if(!details?.title.trim()||!details?.description.trim())throw Error("ROOM_DETAILS_REQUIRED");
  const ix=base.indexOf("\n方式："),first=base.indexOf("\n");
  if(!base.startsWith("🎬 ROOM：")||ix<0||first<0||ix<=first)
   throw Error("ROOM_PUBLIC_CARD_LAYOUT_NOT_VERIFIED");
  const esc=(v:string)=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  base="🎬 ROOM："+esc(details.title)+"\n"+esc(details.description)+base.slice(ix);
 }
 // Content edits must not erase the active lifecycle mark (予告中/LIVE中/終了).
 // Only a lifecycle event is authorized to change that visible state.
 const previous=original.match(/^状態：([^\r\n]*)$/mu)?.[1];
 const preserved=kind==="details_changed"||kind==="visibility_changed";
 if(preserved&&!previous)throw Error("ROOM_PUBLIC_STATUS_MISSING");
 const status="状態："+(preserved?previous:badge);
 const result=base+"\n"+status;
 if(result.length>4096)throw new Error("ROOM_STATUS_TOO_LONG");
 return result;
}

type Button={text:string;url:string};
function verifyButtons(value:unknown):Button[][]{
 if(!Array.isArray(value)||value.length>40)throw new Error("ROOM_MARKUP_NOT_SNAPSHOTTED");
 return value.map(row=>{
  if(!Array.isArray(row)||row.length>8)throw new Error("ROOM_MARKUP_INVALID");
  return row.map((b:unknown)=>{
   if(!b||typeof b!=="object"||!("text" in b)||!("url" in b)||
      typeof b.text!=="string"||typeof b.url!=="string"||
      b.text.length>64||!/^https:\/\//.test(b.url))
    throw new Error("ROOM_MARKUP_INVALID");
   return {text:b.text,url:b.url};
  });
 });
}

/** Resolve a verified Bot API no-op without replaying a message or guessing. */
export function roomTelegramMessageAlreadyMatches(error:unknown):boolean{
 if(!error||typeof error!=="object"||!("response" in error))return false;
 const r=(error as {response?:{error_code?:number;description?:string}}).response;
 return r?.error_code===400&&typeof r.description==="string"&&
  r.description.toLowerCase().includes("message is not modified");
}
/** Fixed code only: never write Telegram's raw error, chat/message ID, or text. */
export function classifyRoomTelegramEditFailure(error:unknown):string{
 if(!error||typeof error!=="object"||!("response" in error))
  return "NO_TELEGRAM_RESPONSE";
 const response=(error as {response?:{error_code?:number;description?:string}}).response;
 const code=response?.error_code;
 const desc=typeof response?.description==="string"?
   response.description.toLowerCase():"";
 if(code===400){
  if(desc.includes("message is not modified"))return "MESSAGE_ALREADY_MATCHES";
  if(desc.includes("message can't be edited")||
     desc.includes("message cannot be edited"))return "MESSAGE_EDIT_NOT_PERMITTED";
  if(desc.includes("message to edit not found"))return "MESSAGE_TO_EDIT_NOT_FOUND";
  if(desc.includes("can't parse entities"))return "MESSAGE_PARSE_REJECTED";
  if(desc.includes("message thread not found"))return "MESSAGE_THREAD_NOT_FOUND";
  if(desc.includes("chat not found"))return "CHAT_NOT_FOUND";
  return "TELEGRAM_BAD_REQUEST";
 }
 if(code===403)return "TELEGRAM_FORBIDDEN";
 if(code===429)return "TELEGRAM_RATE_LIMIT";
 if(typeof code==="number")return "TELEGRAM_HTTP_OTHER";
 return "NO_TELEGRAM_RESPONSE";
}
export function roomTerminalMatchesSource(roomStatus:string,kind:string):boolean{
 return (roomStatus==="finished"&&kind==="finished")||
        (roomStatus==="cancelled"&&kind==="cancelled");
}

export async function updateNextRoomStatusMessage(telegram:Telegram):Promise<{
 editId:number;state:"confirmed"|"needs_reconcile";
}|null>{
 if(process.env.GAYBBS_ROOM_STATUS_EDIT_ENABLED!=="enabled")
  throw new Error("ROOM_STATUS_EDIT_RELEASE_LOCKED");
 const gate=await pool.query(
  `SELECT 1 FROM gaybbs_feature_release_gates
    WHERE feature IN ('room','announcement') AND enabled=TRUE
      AND length(source_commit)=40
      AND length(trim(ci_evidence))>0
      AND length(trim(gserver_runtime_evidence))>0
      AND length(trim(telegram_e2e_evidence))>0
    GROUP BY approved_by HAVING count(DISTINCT feature)=2`);
 if(gate.rows.length!==1)throw new Error("ROOM_STATUS_FEATURES_NOT_VERIFIED");
 const c=await pool.connect();
 let item:null|{editId:number;eventId:number;deliveryId:number;chatId:number;messageId:number;
  original:string;kind:PublicRoomStatus;buttons:Button[][];details?:{title:string;description:string}}=null;
 try{
  await c.query("BEGIN");
  const result=await c.query(
   `SELECT q.edit_id,q.room_event_id,d.delivery_id,t.chat_id,d.telegram_message_id,d.rendered_text,e.kind,d.inline_buttons,r.title AS room_title,r.description AS room_description
    FROM room_status_message_edits q
    JOIN room_source_events e ON e.event_id=q.room_event_id
    JOIN posting_deliveries d ON d.delivery_id=q.delivery_id
    JOIN posting_topics t ON t.topic_id=d.posting_topic_id
    JOIN announcement_posts a ON a.announcement_id::text=d.source_id
    JOIN room_posts r ON r.room_id=a.room_id
    WHERE q.state='pending' AND e.state='applied'
      AND d.status='sent' AND d.telegram_message_id IS NOT NULL
      AND t.enabled=TRUE AND t.purpose IN ('room','announcement')
      AND (
        -- A source-confirmed terminal ROOM overrides its stale intermediate
        -- LIVE attempts, but never overtakes a Telegram send in flight.
        (r.status IN ('finished','cancelled') AND e.kind=r.status
          AND NOT EXISTS (
            SELECT 1 FROM room_status_message_edits inflight
            WHERE inflight.delivery_id=q.delivery_id
              AND inflight.edit_id<>q.edit_id AND inflight.state='sending'
          ))
        OR NOT EXISTS (
          SELECT 1 FROM room_status_message_edits prev
          JOIN room_source_events prev_event ON prev_event.event_id=prev.room_event_id
          WHERE prev.delivery_id=q.delivery_id
            AND prev_event.event_id<e.event_id
            AND prev.state NOT IN ('confirmed','skipped')
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM room_status_message_edits later
        JOIN room_source_events later_event ON later_event.event_id=later.room_event_id
        WHERE later.delivery_id=q.delivery_id
          AND later_event.event_id>e.event_id AND later.state='confirmed'
      )
    ORDER BY CASE WHEN r.status IN ('finished','cancelled') AND e.kind=r.status
              THEN 0 ELSE 1 END,q.room_event_id,q.edit_id
    LIMIT 1 FOR UPDATE OF q SKIP LOCKED`);
  if(!result.rows.length){await c.query("COMMIT");return null;}
  const r=result.rows[0];
  const editId=Number(r.edit_id),eventId=Number(r.room_event_id),
   deliveryId=Number(r.delivery_id),chatId=Number(r.chat_id),
   messageId=Number(r.telegram_message_id);
  if(!Number.isSafeInteger(editId)||editId<=0||
     !Number.isSafeInteger(eventId)||eventId<=0||
     !Number.isSafeInteger(deliveryId)||deliveryId<=0||
     !Number.isSafeInteger(chatId)||chatId>=0||
     !Number.isSafeInteger(messageId)||messageId<=0)
   throw new Error("ROOM_STATUS_DELIVERY_INVALID");
  const terminal=r.kind==="finished"||r.kind==="cancelled";
  if(r.rendered_text===null||(!terminal&&r.inline_buttons===null)){
   // A pre-migration post may have a live recruitment/menu keyboard. Never
   // silently erase it, nor spin forever on the same pending item.
   await c.query(
    `UPDATE room_status_message_edits SET state='needs_reconcile',
      updated_at=NOW() WHERE edit_id=$1 AND state='pending'`,[editId]);
   await c.query("COMMIT");
   return {editId,state:"needs_reconcile"};
  }
  item={editId,eventId,deliveryId,chatId,messageId,original:String(r.rendered_text),
   kind:r.kind as PublicRoomStatus,
   buttons:terminal?[]:verifyButtons(r.inline_buttons),
   details:r.kind==="details_changed"?{title:String(r.room_title),description:String(r.room_description)}:undefined};
  await c.query(
   `UPDATE room_status_message_edits SET state='sending',updated_at=NOW()
    WHERE edit_id=$1 AND state='pending'`,[editId]);
  await c.query("COMMIT");
 }catch(error){await c.query("ROLLBACK");throw error;}
 finally{c.release();}
 if(!item)return null;
 try{
  const terminal=["finished","cancelled"].includes(item.kind);
  const buttons=terminal?[]:item.buttons;
  const keyboard=Markup.inlineKeyboard(buttons.map(row=>row.map(b=>
   Markup.button.url(b.text,b.url))));
  const rendered=roomStatusMessage(item.original,item.kind,item.details);
  try{
   await telegram.editMessageText(item.chatId,item.messageId,undefined,
    rendered,{parse_mode:"HTML",...keyboard});
  }catch(error){
   // A 400 exact no-op proves Telegram already has the requested payload.
   // Other or ambiguous errors remain needs_reconcile, never blind retries.
   if(!roomTelegramMessageAlreadyMatches(error)){
    console.warn("ROOM_PUBLIC_TELEGRAM_EDIT_REJECTED",
      classifyRoomTelegramEditFailure(error));
    throw error;
   }
  }
  const cx=await pool.connect();
  try{
   await cx.query("BEGIN");
   const save=await cx.query(
    "UPDATE posting_deliveries SET rendered_text=$3,updated_at=NOW() WHERE delivery_id=$1 AND telegram_message_id=$2 AND status='sent' RETURNING delivery_id",
    [item.deliveryId,item.messageId,rendered]);
   if(save.rows.length!==1)throw Error("ROOM_DELIVERY_CONTENT_STALE");
   const ack=await cx.query(
    "UPDATE room_status_message_edits SET state='confirmed',updated_at=NOW() WHERE edit_id=$1 AND state='sending' RETURNING edit_id",
    [item.editId]);
   if(ack.rows.length!==1)throw Error("ROOM_EDIT_ACK_UNCERTAIN");
   if(terminal){
    // Only AFTER the final Telegram edit is acknowledged may older
    // unresolved revisions be superseded. Never mark them sent/confirmed.
    await cx.query(
     `UPDATE room_status_message_edits old SET state='skipped',updated_at=NOW()
       FROM room_source_events prior
       WHERE old.room_event_id=prior.event_id
         AND old.delivery_id=$1 AND prior.event_id<$2
         AND old.state IN ('pending','needs_reconcile')`,
     [item.deliveryId,item.eventId]);
   }
   await cx.query("COMMIT");
  }catch(error){await cx.query("ROLLBACK");throw error;}finally{cx.release();}
  return {editId:item.editId,state:"confirmed"};
 }catch{
  await pool.query(
   `UPDATE room_status_message_edits SET state='needs_reconcile',updated_at=NOW()
    WHERE edit_id=$1 AND state='sending'`,[item.editId]);
  return {editId:item.editId,state:"needs_reconcile"};
 }
}
