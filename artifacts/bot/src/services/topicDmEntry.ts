/** Single, opaque DM doorway pinned inside each verified existing forum Topic.
 * No posting editor or 10-button keyboard is placed in the group.
 * Pin identifiers come from verified DB records, not t.me URLs.
 */
import type { Telegram } from "telegraf";
import { pool } from "../db/index.js";
import { newMenuToken, tokenHash } from "./menuOrigin.js";
import { BOARD_GROUP_CHAT_IDS } from "./topicRouting.js";

export const TOPIC_ENTRY_TEXT =
  "📝 このトピックに投稿するには、下のボタンからBotのDMへ移動してください。";
export const TOPIC_ENTRY_BUTTON = "📝 投稿メニューを開く";

const ALLOWED_CHATS = new Set<number>([
  BOARD_GROUP_CHAT_IDS.area_bbs,
  BOARD_GROUP_CHAT_IDS.video_chat,
  BOARD_GROUP_CHAT_IDS.gay_board,
]);
const tokenPattern=/^p_([A-Za-z0-9_-]{32})$/;
export function parseTopicEntryPayload(payload:string):string{
 const match=tokenPattern.exec(payload);
 if(!match)throw Error("TOPIC_ENTRY_PAYLOAD_INVALID");
 return match[1]!;
}
export type TopicEntryOrigin = {chatId:number;threadId:number};

/** A saved Telegram forum chat ID is negative. Never silently drop a
 * previously bound destination because it is not a positive integer.
 */
export function draftTopicEntryOrigin(
 chatId:unknown,threadId:unknown,
):TopicEntryOrigin|null{
 if(chatId==null&&threadId==null)return null;
 const chat=Number(chatId),thread=Number(threadId);
 if(!ALLOWED_CHATS.has(chat)||!Number.isSafeInteger(thread)||thread<=0)
  throw Error("TOPIC_ENTRY_DRAFT_CONTEXT_INVALID");
 return {chatId:chat,threadId:thread};
}

/** A private draft created through a pinned Topic cannot silently move to another Topic.
 * Returning to a menu does not call this guard; only publication does.
 */
export function assertBoundTopicDmEntry(
 draft:TopicEntryOrigin|null,current:TopicEntryOrigin|null,destination:TopicEntryOrigin,
):void{
 if(draft&&(!current||draft.chatId!==current.chatId||draft.threadId!==current.threadId))
  throw Error("TOPIC_ENTRY_CONTEXT_CHANGED");
 if((draft&&(draft.chatId!==destination.chatId||draft.threadId!==destination.threadId))||
    (current&&(current.chatId!==destination.chatId||current.threadId!==destination.threadId)))
  throw Error("TOPIC_ENTRY_DESTINATION_MISMATCH");
}


export async function activateTopicDmEntry(
 userId:number,payload:string,telegram:Telegram,
):Promise<TopicEntryOrigin>{
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error("TOPIC_ENTRY_ACTOR_INVALID");
 const hash=tokenHash(parseTopicEntryPayload(payload));
 const row=await pool.query(
  `SELECT chat_id,message_thread_id FROM topic_dm_entry_pins
   WHERE token_hash=$1 AND state='published' AND pinned=TRUE`,[hash]);
 if(row.rows.length!==1)throw Error("TOPIC_ENTRY_NOT_PUBLISHED");
 const chatId=Number(row.rows[0].chat_id);
 const threadId=Number(row.rows[0].message_thread_id);
 if(!ALLOWED_CHATS.has(chatId)||!Number.isSafeInteger(threadId)||threadId<=0)
  throw Error("TOPIC_ENTRY_NOT_REGISTERED");
 // Prove the user is still a member of the originating forum.
 const membership=await telegram.getChatMember(chatId,userId);
 if(membership.status==="left"||membership.status==="kicked"||
    (membership.status==="restricted"&&!membership.is_member))
  throw Error("TOPIC_ENTRY_MEMBERSHIP_REQUIRED");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  await client.query(
   `INSERT INTO topic_dm_entry_sessions(owner_user_id,chat_id,message_thread_id,token_hash,expires_at)
    VALUES($1,$2,$3,$4,NOW()+INTERVAL '24 hours')
    ON CONFLICT(owner_user_id) DO UPDATE SET chat_id=EXCLUDED.chat_id,
     message_thread_id=EXCLUDED.message_thread_id,token_hash=EXCLUDED.token_hash,
     expires_at=EXCLUDED.expires_at,updated_at=NOW()`,
   [userId,chatId,threadId,hash]);
  // The newest authenticated doorway owns the DM posting destination.
  await client.query("DELETE FROM board_menu_sessions WHERE owner_user_id=$1",[userId]);
  await client.query("COMMIT");
 }catch(error){
  await client.query("ROLLBACK");
  throw error;
 }finally{client.release();}
 return {chatId,threadId};
}

export async function currentTopicDmEntry(userId:number):Promise<TopicEntryOrigin|null>{
 const r=await pool.query(
  `SELECT s.chat_id,s.message_thread_id FROM topic_dm_entry_sessions s
   JOIN topic_dm_entry_pins p ON p.token_hash=s.token_hash
   WHERE s.owner_user_id=$1 AND s.expires_at>NOW()
     AND p.state='published' AND p.pinned=TRUE
     AND s.chat_id=p.chat_id AND s.message_thread_id=p.message_thread_id`,[userId]);
 if(r.rows.length!==1)return null;
 const chatId=Number(r.rows[0].chat_id),threadId=Number(r.rows[0].message_thread_id);
 if(!ALLOWED_CHATS.has(chatId)||!Number.isSafeInteger(threadId)||threadId<=0)return null;
 return {chatId,threadId};
}

/** Reject stale/foreign callback targets after returning from an editor. */
export async function assertTopicDmEntryDestination(
 userId:number,chatId:number,threadId:number,
):Promise<void>{
 const pinned=await currentTopicDmEntry(userId);
 if(pinned&&(pinned.chatId!==chatId||pinned.threadId!==threadId))
  throw Error("TOPIC_ENTRY_DESTINATION_MISMATCH");
}

/** Uses the existing pinned message ID on reruns. Any ambiguous Telegram result
 * is recorded needs_reconcile: never automatically send a duplicate.
 */
export async function publishTopicDmEntry(
 telegram:Telegram,chatId:number,threadId:number,title:string,adminId:number,
):Promise<{messageId:number;updatedExisting:boolean}>{
 if(process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")
  throw Error("PUBLIC_MENUS_NOT_RELEASED");
 if(!ALLOWED_CHATS.has(chatId)||!Number.isSafeInteger(threadId)||threadId<=0||
    !title.trim()||title.length>100)throw Error("TOPIC_ENTRY_TARGET_INVALID");
 const member=await telegram.getChatMember(chatId,adminId);
 if(member.status!=="creator"&&member.status!=="administrator")
  throw Error("TOPIC_ENTRY_ADMIN_REQUIRED");
 const botInfo=await telegram.getMe();
 const botMember=await telegram.getChatMember(chatId,botInfo.id);
 if(botMember.status!=="creator"&&botMember.status!=="administrator"||
    (botMember.status==="administrator"&&!botMember.can_pin_messages))
  throw Error("TOPIC_ENTRY_BOT_PIN_PERMISSION_REQUIRED");
 const old=await pool.query(
  `SELECT message_id,state,pinned FROM topic_dm_entry_pins
   WHERE chat_id=$1 AND message_thread_id=$2`,[chatId,threadId]);
 if(old.rows.length){
  if(old.rows[0].state==="published"&&old.rows[0].pinned===true&&
     Number(old.rows[0].message_id)>0)
   return {messageId:Number(old.rows[0].message_id),updatedExisting:true};
  if(old.rows[0].state!=="verified"||old.rows[0].message_id!==null)
   throw Error("TOPIC_ENTRY_NEEDS_RECONCILE");
 }
 const token=newMenuToken(),hash=tokenHash(token);
 const claimed=await pool.query(
  `INSERT INTO topic_dm_entry_pins(chat_id,message_thread_id,title,token_hash,verified_by,state)
   VALUES($1,$2,$3,$4,$5,'publishing')
   ON CONFLICT(chat_id,message_thread_id) DO UPDATE SET
    title=EXCLUDED.title,token_hash=EXCLUDED.token_hash,
    state='publishing',updated_at=NOW()
   WHERE topic_dm_entry_pins.state='verified'
     AND topic_dm_entry_pins.message_id IS NULL
   RETURNING token_hash,message_id,pinned,state`,
  [chatId,threadId,title,hash,adminId]);
 if(claimed.rows.length!==1)throw Error("TOPIC_ENTRY_NEEDS_RECONCILE");
 let sent=false;
 try {
  const buttonUrl="https://t.me/GayBBS_bot?start=p_"+token;
  const message=await telegram.sendMessage(chatId,TOPIC_ENTRY_TEXT,{
   message_thread_id:threadId,
   reply_markup:{inline_keyboard:[[{text:TOPIC_ENTRY_BUTTON,url:buttonUrl}]]},
  });
  sent=true;
  await pool.query(
   `UPDATE topic_dm_entry_pins SET message_id=$3,updated_at=NOW()
    WHERE chat_id=$1 AND message_thread_id=$2 AND state='publishing'`,
   [chatId,threadId,message.message_id]);
  await telegram.pinChatMessage(chatId,message.message_id,{disable_notification:true});
  await pool.query(
   `UPDATE topic_dm_entry_pins SET state='published',pinned=TRUE,updated_at=NOW()
    WHERE chat_id=$1 AND message_thread_id=$2 AND message_id=$3
      AND state='publishing'`,
   [chatId,threadId,message.message_id]);
  return {messageId:message.message_id,updatedExisting:false};
 }catch(error){
  await pool.query(
   `UPDATE topic_dm_entry_pins SET state=$3,updated_at=NOW()
    WHERE chat_id=$1 AND message_thread_id=$2 AND state='publishing'`,
   [chatId,threadId,sent?"needs_reconcile":"verified"]);
  throw error;
 }
}
