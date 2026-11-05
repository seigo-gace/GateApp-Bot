/** Existing Telegram ROOM announcement remains in the group after meeting.
 * The temporary ROOM database may be purged only after confirmed edits.
 * Never include the private meeting URL in public status text.
 */
import type {Telegram} from "telegraf";
import {Markup} from "telegraf";
import {pool} from "../db/index.js";

export type PublicRoomStatus="scheduled"|"prepared"|"started"|"postponed"|
 "cancelled"|"finished"|"visibility_changed";

export function roomBadge(kind:PublicRoomStatus):string{
 const badges:Record<PublicRoomStatus,string>={
  scheduled:"📅 開催予定",
  prepared:"🟢 準備完了",
  started:"🔴 LIVE中",
  postponed:"⏸ 延期",
  cancelled:"🚫 中止",
  finished:"⚫ 終了しました",
  visibility_changed:"🔒 参加条件を更新しました",
 };
 if(!(kind in badges))throw new Error("ROOM_BADGE_UNRECOGNIZED");
 return badges[kind];
}
export function roomStatusMessage(original:string,kind:PublicRoomStatus):string{
 if(!original.trim()||original.length>3700)
  throw new Error("ROOM_STATUS_TEXT_INVALID");
 // ROOM meeting links belong solely in authorized DM, not in a public post.
 if(/https?:\/\/[^\s"'<>]*\/(?:GayBBS-|PRIVATE_)/i.test(original))
  throw new Error("ROOM_PRIVATE_LINK_PUBLIC_REFUSED");
 const badge=roomBadge(kind);
 const base=original.replace(/^状態：[^\r\n]*/mu,"").trimEnd();
 const status="状態："+badge;
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
 let item:null|{editId:number;chatId:number;messageId:number;
  original:string;kind:PublicRoomStatus;buttons:Button[][]}=null;
 try{
  await c.query("BEGIN");
  const result=await c.query(
   `SELECT q.edit_id,t.chat_id,d.telegram_message_id,a.text,e.kind,d.inline_buttons
    FROM room_status_message_edits q
    JOIN room_source_events e ON e.event_id=q.room_event_id
    JOIN posting_deliveries d ON d.delivery_id=q.delivery_id
    JOIN posting_topics t ON t.topic_id=d.posting_topic_id
    JOIN announcement_posts a ON a.announcement_id::text=d.source_id
    WHERE q.state='pending' AND e.state='applied'
      AND d.status='sent' AND d.telegram_message_id IS NOT NULL
      AND t.enabled=TRUE AND t.purpose='announcement'
    ORDER BY q.room_event_id,q.edit_id LIMIT 1 FOR UPDATE OF q SKIP LOCKED`);
  if(!result.rows.length){await c.query("COMMIT");return null;}
  const r=result.rows[0];
  const editId=Number(r.edit_id),chatId=Number(r.chat_id),
   messageId=Number(r.telegram_message_id);
  if(!Number.isSafeInteger(editId)||editId<=0||
     !Number.isSafeInteger(chatId)||chatId>=0||
     !Number.isSafeInteger(messageId)||messageId<=0)
   throw new Error("ROOM_STATUS_DELIVERY_INVALID");
  if(r.inline_buttons===null){
   // A pre-migration post may have a live recruitment/menu keyboard. Never
   // silently erase it, nor spin forever on the same pending item.
   await c.query(
    `UPDATE room_status_message_edits SET state='needs_reconcile',
      updated_at=NOW() WHERE edit_id=$1 AND state='pending'`,[editId]);
   await c.query("COMMIT");
   return {editId,state:"needs_reconcile"};
  }
  item={editId,chatId,messageId,original:String(r.text),
   kind:r.kind as PublicRoomStatus,
   buttons:verifyButtons(r.inline_buttons)};
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
  await telegram.editMessageText(item.chatId,item.messageId,undefined,
   roomStatusMessage(item.original,item.kind),{
    parse_mode:"HTML",...keyboard,
  });
  const ack=await pool.query(
   `UPDATE room_status_message_edits SET state='confirmed',updated_at=NOW()
     WHERE edit_id=$1 AND state='sending' RETURNING edit_id`,[item.editId]);
  if(ack.rows.length!==1)throw new Error("ROOM_EDIT_ACK_UNCERTAIN");
  return {editId:item.editId,state:"confirmed"};
 }catch{
  await pool.query(
   `UPDATE room_status_message_edits SET state='needs_reconcile',updated_at=NOW()
    WHERE edit_id=$1 AND state='sending'`,[item.editId]);
  return {editId:item.editId,state:"needs_reconcile"};
 }
}
