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

/** One shared verified-origin resolver for recruitment and Room+募集.
 * No fallback to another group or Topic. A missing match is an explicit error
 * path owned by the caller, never implicit auto-posting elsewhere.
 */
export function verifiedOriginTopic<T extends {chatId:number;threadId:number}>(
 topics:readonly T[],origin:TopicEntryOrigin|null,
):T|null{
 if(!origin)return null;
 return topics.find(t=>t.chatId===origin.chatId&&t.threadId===origin.threadId)??null;
}


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

/** Reconcile only an already-known Telegram message, never create another
 * group message when the first send may have succeeded. */
export function canReuseUncertainEntry(state:string,messageId:unknown):boolean{
 const id=Number(messageId);
 return (state==="needs_reconcile"||state==="publishing") &&
   Number.isSafeInteger(id)&&id>0;
}

/** Restore an existing shared DM doorway by editing its original message ID.
 * We never publish a second message for an uncertain prior send. */
export async function recoverExistingTopicDmEntry(
 telegram:Telegram,chatId:number,threadId:number,adminId:number,
):Promise<{messageId:number;updatedExisting:true}>{
 if(process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")
  throw Error("PUBLIC_MENUS_NOT_RELEASED");
 if(!ALLOWED_CHATS.has(chatId)||!Number.isSafeInteger(threadId)||threadId<=0)
  throw Error("TOPIC_ENTRY_TARGET_INVALID");
 const operator=await telegram.getChatMember(chatId,adminId);
 if(operator.status!=="administrator"&&operator.status!=="creator")
  throw Error("TOPIC_ENTRY_ADMIN_REQUIRED");
 const botInfo=await telegram.getMe();
 const botMember=await telegram.getChatMember(chatId,botInfo.id);
 if(botMember.status!=="creator"&&
   (botMember.status!=="administrator"||!botMember.can_pin_messages))
  throw Error("TOPIC_ENTRY_BOT_PIN_PERMISSION_REQUIRED");
 const existing=await pool.query(
  `SELECT state,pinned,message_id,title FROM topic_dm_entry_pins
   WHERE chat_id=$1 AND message_thread_id=$2`,[chatId,threadId]);
 if(existing.rows.length!==1)throw Error("TOPIC_ENTRY_RECONCILE_NOT_FOUND");
 const row=existing.rows[0];
 if(!canReuseUncertainEntry(String(row.state),row.message_id))
  throw Error("TOPIC_ENTRY_RECONCILE_NO_KNOWN_MESSAGE");
 const messageId=Number(row.message_id);
 const token=newMenuToken(),hash=tokenHash(token);
 const buttonUrl="https://t.me/GayBBS_bot?start=p_"+token;
 // Telegram's successful edit proves this exact message exists and is
 // writable by the Bot. Retain it rather than posting a duplicate.
 await telegram.editMessageText(chatId,messageId,undefined,TOPIC_ENTRY_TEXT,{
  reply_markup:{inline_keyboard:[[{text:TOPIC_ENTRY_BUTTON,url:buttonUrl,style:"primary"} as any]]},
 });
 await telegram.pinChatMessage(chatId,messageId,{disable_notification:true});
 const saved=await pool.query(
  `UPDATE topic_dm_entry_pins SET token_hash=$4,state='published',
     pinned=TRUE,updated_at=NOW()
   WHERE chat_id=$1 AND message_thread_id=$2 AND message_id=$3
     AND state IN ('needs_reconcile','publishing')
   RETURNING message_id`,[chatId,threadId,messageId,hash]);
 if(saved.rows.length!==1)throw Error("TOPIC_ENTRY_RECONCILE_CONCURRENT_CHANGE");
 return {messageId,updatedExisting:true};
}

/** Replace an EXISTING published topic doorway in place. It must always open
 * the posting menu (p_), never a direct Room editor (m_).
 * No new topic messages, no repost, and no guessed message IDs.
 */
export async function refreshPublishedTopicDmEntry(
 telegram:Telegram,chatId:number,threadId:number,
):Promise<{messageId:number;updatedExisting:true}>{
 if(process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")
  throw Error("PUBLIC_MENUS_NOT_RELEASED");
 if(!ALLOWED_CHATS.has(chatId)||!Number.isSafeInteger(threadId)||threadId<=0)
  throw Error("TOPIC_ENTRY_TARGET_INVALID");
 const old=await pool.query(
  `SELECT message_id,token_hash,state,pinned FROM topic_dm_entry_pins
   WHERE chat_id=$1 AND message_thread_id=$2`,[chatId,threadId]);
 if(old.rows.length!==1||old.rows[0].state!=="published"||
    old.rows[0].pinned!==true||!Number.isSafeInteger(Number(old.rows[0].message_id))||
    Number(old.rows[0].message_id)<=0)
  throw Error("TOPIC_ENTRY_EXISTING_PIN_NOT_VERIFIED");
 const messageId=Number(old.rows[0].message_id);
 const oldHash=String(old.rows[0].token_hash);
 const token=newMenuToken(),hash=tokenHash(token);
 const buttonUrl="https://t.me/GayBBS_bot?start=p_"+token;
 // Only update the existing message. Telegram's edit may fail or be ambiguous:
 // keep the prior pin and avoid a duplicate send in either case.
 try{
  await telegram.editMessageText(chatId,messageId,undefined,TOPIC_ENTRY_TEXT,{
   reply_markup:{inline_keyboard:[[{text:TOPIC_ENTRY_BUTTON,url:buttonUrl,style:"primary"} as any]]},
  });
 }catch(e){
  await pool.query(
   `UPDATE topic_dm_entry_pins SET state='needs_reconcile',updated_at=NOW()
    WHERE chat_id=$1 AND message_thread_id=$2 AND message_id=$3
      AND token_hash=$4 AND state='published'`,
   [chatId,threadId,messageId,oldHash]);
  throw e;
 }
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  // Old opaque links can no longer be used after successful Telegram edit.
  // Expire only this doorway's transient sessions to honor the existing FK.
  await c.query(
   "DELETE FROM topic_dm_entry_sessions WHERE token_hash=$1",[oldHash]);
  const updated=await c.query(
   `UPDATE topic_dm_entry_pins SET token_hash=$5,updated_at=NOW()
    WHERE chat_id=$1 AND message_thread_id=$2 AND message_id=$3
      AND token_hash=$4 AND state='published' AND pinned=TRUE
    RETURNING message_id`,[chatId,threadId,messageId,oldHash,hash]);
  if(updated.rows.length!==1)throw Error("TOPIC_ENTRY_REFRESH_RACE");
  await c.query("COMMIT");
 }catch(e){
  await c.query("ROLLBACK");
  await pool.query(
   `UPDATE topic_dm_entry_pins SET state='needs_reconcile',updated_at=NOW()
    WHERE chat_id=$1 AND message_thread_id=$2 AND message_id=$3`,
   [chatId,threadId,messageId]);
  throw e;
 }finally{c.release();}
 return {messageId,updatedExisting:true};
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
   reply_markup:{inline_keyboard:[[{text:TOPIC_ENTRY_BUTTON,url:buttonUrl,style:"primary"} as any]]},
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
