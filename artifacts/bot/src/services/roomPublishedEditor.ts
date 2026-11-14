/** Owner-scoped published Room+募集 editor. ROOM owns meeting state, its linked
 * recruitment announcement owns the group post, MPB owns message IDs.
 * Never copy or re-send a public post when opening its management screen.
 */
import {pool} from "../db/index.js";
import {Markup} from "telegraf";
import {styledInlineButton as colored} from "./inlineButtonStyle.js";
import {adaptiveChoiceRows} from "./inlineSelection.js";
import {BOARD_TITLES,BOARD_GROUP_CHAT_IDS,type BoardKey} from "./topicRouting.js";
import {telegramPublishedMessageUrl} from "./searchDomain.js";
import type {Telegram} from "telegraf";
import {createTelegramDispatcher} from "./telegramDispatcher.js";
import {updateRoomState} from "./roomLifecycle.js";

export type RoomPublication={
 announcementId:number;roomId:number;roomRevision:number;
 groupTitle:string;topicTitle:string;chatId:number;messageId:number;
 title:string;description:string;status:string;visibility:string;
 scheduledAt:string|null;ownerJoinUrl:string|null;
 destinations?:{chatId:number;threadId:number;messageId:number;topicTitle:string}[];
};
/** Only a fully acknowledged ROOM can be recovered as published.
 * Reuse existing MPB receipts; never send or infer an uncertain Telegram post. */
export function completeRoomDeliveryReceipts(
 expectedTopicIds:readonly number[],
 receipts:readonly {posting_topic_id:unknown;status:string;telegram_message_id:unknown}[],
):boolean{
 if(!expectedTopicIds.length||new Set(expectedTopicIds).size!==expectedTopicIds.length||
    expectedTopicIds.some(id=>!Number.isSafeInteger(id)||id<=0)||
    receipts.length!==expectedTopicIds.length)return false;
 const expected=new Set(expectedTopicIds);
 for(const d of receipts){
  const id=Number(d.posting_topic_id),messageId=Number(d.telegram_message_id);
  if(!expected.delete(id)||d.status!=="sent"||
     !Number.isSafeInteger(messageId)||messageId<=0)return false;
 }
 return expected.size===0;
}
/** An absent delivery or untouched pending claim can be resumed using the same
 * request key; already acknowledged sends are reused. An in-flight or unknown
 * Telegram outcome can never be sent again automatically. */
export function canResumeRoomDeliveries(
 expectedTopicIds:readonly number[],
 receipts:readonly {posting_topic_id:unknown;status:string;telegram_message_id:unknown}[],
):boolean{
 if(!expectedTopicIds.length||new Set(expectedTopicIds).size!==expectedTopicIds.length||
    expectedTopicIds.some(id=>!Number.isSafeInteger(id)||id<=0))return false;
 const expected=new Set(expectedTopicIds),seen=new Set<number>();
 for(const d of receipts){
  const id=Number(d.posting_topic_id);
  if(!expected.has(id)||seen.has(id))return false;
  seen.add(id);
  if(d.status==="sent"){
   const msg=Number(d.telegram_message_id);
   if(!Number.isSafeInteger(msg)||msg<=0)return false;
  }else if(d.status==="pending"){
   if(d.telegram_message_id!==null)return false;
  }else return false;
 }
 return true;
}
export async function mayResumeRoomPublication(owner:number,revision:number,
 expectedTopicIds:readonly number[]):Promise<boolean>{
 if(!Number.isSafeInteger(owner)||owner<=0||
    !Number.isSafeInteger(revision)||revision<=0)return false;
 const rows=await pool.query(
  `SELECT d.posting_topic_id,d.status,d.telegram_message_id
   FROM posting_deliveries d JOIN announcement_posts a
    ON d.source_type='announcement' AND d.source_id=a.announcement_id::text
   JOIN room_posts r ON r.room_id=a.room_id AND r.owner_user_id=a.owner_user_id
   WHERE a.owner_user_id=$1 AND a.request_key=$2 AND r.request_key=$3`,
  [owner,"room-announcement:"+owner+":"+revision,"room:"+owner+":"+revision]);
 return canResumeRoomDeliveries(expectedTopicIds,rows.rows);
}
/** Reconcile source status after BOTH Telegram sends have existing MPB ACKs.
 * Nothing is published by this method; incomplete/uncertain sends remain blocked. */
export async function recoverFullySentRoom(owner:number,revision:number,
 expectedTopicIds:readonly number[]):Promise<number|null>{
 if(!Number.isSafeInteger(owner)||owner<=0||
    !Number.isSafeInteger(revision)||revision<=0)return null;
 const source=await pool.query(
  `SELECT a.announcement_id,a.status
   FROM announcement_posts a JOIN room_posts r
     ON r.room_id=a.room_id AND r.owner_user_id=a.owner_user_id
   WHERE a.owner_user_id=$1 AND a.kind='recruitment'
     AND a.request_key=$2 AND r.request_key=$3
     AND a.status IN ('draft','published')`,
  [owner,"room-announcement:"+owner+":"+revision,"room:"+owner+":"+revision]);
 if(source.rows.length!==1)return null;
 const id=Number(source.rows[0].announcement_id);
 if(!Number.isSafeInteger(id)||id<=0)return null;
 const rows=await pool.query(
  `SELECT posting_topic_id,status,telegram_message_id FROM posting_deliveries
   WHERE source_type='announcement' AND source_id=$1 AND owner_user_id=$2`,
  [String(id),owner]);
 if(!completeRoomDeliveryReceipts(expectedTopicIds,rows.rows))return null;
 if(source.rows[0].status==="draft"){
  const change=await pool.query(
   `UPDATE announcement_posts SET status='published',
      accept_applications=CASE WHEN EXISTS (
       SELECT 1 FROM room_posts r WHERE r.room_id=announcement_posts.room_id
        AND r.join_visibility='approved_only' AND r.status IN ('draft','scheduled','ready')
      ) THEN TRUE ELSE FALSE END,updated_at=NOW()
     WHERE announcement_id=$1 AND owner_user_id=$2 AND status='draft'
     RETURNING announcement_id`,[id,owner]);
  if(change.rows.length!==1){
   const already=await pool.query(
    "SELECT announcement_id FROM announcement_posts WHERE announcement_id=$1 AND owner_user_id=$2 AND status='published'",
    [id,owner]);
   if(already.rows.length!==1)return null;
  }
 }
 return id;
}
/** "即開始" becomes LIVE only after all destination MPB receipts are confirmed
 * and the linked announcement is published. Reconcile reuses this transition;
 * it never creates another ROOM or sends another Telegram message.
 */
export async function ensureImmediatePublishedRoomLive(
 owner:number,announcementId:number,
):Promise<number|null>{
 if(![owner,announcementId].every(n=>Number.isSafeInteger(n)&&n>0))
  throw Error("ROOM_IMMEDIATE_START_OWNER_INVALID");
 const rows=await pool.query(
  `SELECT r.room_id,r.status,r.revision
    FROM announcement_posts a JOIN room_posts r
      ON r.room_id=a.room_id AND r.owner_user_id=a.owner_user_id
    WHERE a.owner_user_id=$1 AND a.announcement_id=$2
      AND a.status='published' AND r.start_at IS NULL
      AND r.join_visibility='public'`,
  [owner,announcementId]);
 if(rows.rows.length!==1)throw Error("ROOM_IMMEDIATE_START_SOURCE_UNVERIFIED");
 const room=rows.rows[0];
 if(room.status==="live")return null;
 if(room.status!=="draft")throw Error("ROOM_IMMEDIATE_START_STATE_INVALID");
 try{
  const changed=await updateRoomState(owner,Number(room.room_id),Number(room.revision),"start");
  return changed.eventId;
 }catch(error){
  // Two legitimate recovery callbacks may race. An already committed LIVE
  // result is success; all other concurrent changes remain fail-closed.
  if(error instanceof Error&&error.message==="ROOM_REVISION_STALE"){
   const current=await pool.query(
    "SELECT status FROM room_posts WHERE room_id=$1 AND owner_user_id=$2",
    [Number(room.room_id),owner]);
   if(current.rows.length===1&&current.rows[0].status==="live")return null;
  }
  throw error;
 }
}
export async function loadRoomPublication(owner:number,announcementId:number):Promise<RoomPublication>{
 if(![owner,announcementId].every(n=>Number.isSafeInteger(n)&&n>0))
  throw Error("ROOM_PUBLICATION_OWNER_INVALID");
 const r=await pool.query(`
  SELECT a.announcement_id,a.room_id,r.revision AS room_revision,
   r.title,r.description,r.status,r.join_visibility,r.start_at,r.join_url,
   t.board_key,t.title AS topic_title,t.chat_id,t.message_thread_id,d.telegram_message_id
  FROM announcement_posts a
  JOIN room_posts r ON r.room_id=a.room_id AND r.owner_user_id=a.owner_user_id
  JOIN posting_deliveries d ON d.source_type='announcement'
   AND d.source_id=a.announcement_id::text AND d.owner_user_id=a.owner_user_id
   AND d.status='sent' AND d.telegram_message_id IS NOT NULL
  JOIN posting_topics t ON t.topic_id=d.posting_topic_id
  WHERE a.owner_user_id=$1 AND a.announcement_id=$2 AND a.room_id IS NOT NULL
   AND a.status IN ('published','finished','cancelled')
  ORDER BY d.delivery_id ASC`,[owner,announcementId]);
 if(r.rows.length<1)throw Error("ROOM_PUBLICATION_NOT_OWNED_OR_UNCONFIRMED");
 const x=r.rows[0],board=String(x.board_key) as BoardKey;
 const groupTitle=BOARD_TITLES[board];
 if(!groupTitle)throw Error("ROOM_PUBLICATION_GROUP_UNKNOWN");
 const n=(value:unknown)=>Number(value);
 const data:RoomPublication={
  announcementId:n(x.announcement_id),roomId:n(x.room_id),
  roomRevision:n(x.room_revision),groupTitle,topicTitle:String(x.topic_title),
  chatId:n(x.chat_id),messageId:n(x.telegram_message_id),
  title:String(x.title),description:String(x.description),status:String(x.status),
  visibility:String(x.join_visibility),
  scheduledAt:x.start_at?new Date(x.start_at).toISOString():null,
  ownerJoinUrl:typeof x.join_url==="string"&&/^https:\/\//.test(x.join_url)?x.join_url:null,
  destinations:r.rows.map((row:typeof x)=>({
   chatId:n(row.chat_id),threadId:n(row.message_thread_id),messageId:n(row.telegram_message_id),
   topicTitle:String(row.topic_title)})),
 };
 if(![data.announcementId,data.roomId,data.roomRevision,data.messageId].every(
  x=>Number.isSafeInteger(x)&&x>0))throw Error("ROOM_PUBLICATION_RECEIPT_INVALID");
 telegramPublishedMessageUrl(data.chatId,data.messageId);
 return data;
}
export function roomPublicationEditor(p:RoomPublication){
 const state:Record<string,string>={
  draft:"🟡 開始待ち",scheduled:"📅 予告中",ready:"🟡 開始待ち",
  live:"🔴 LIVE中",postponed:"⏸ 延期",cancelled:"🚫 中止",
  finished:"✅ 終了",
 };
 const text=[
  p.groupTitle,
  p.topicTitle+" / 投稿ID："+p.announcementId,
  "🎬 "+p.title,
  "募集内容\n"+p.description,
  "参加："+(p.visibility==="public"?"自由参加":"応募受付"),
  "状態："+(state[p.status]??p.status),
 ];
 if(p.scheduledAt)text.push("開催："+new Date(p.scheduledAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})+"（日本時間）");
 if(p.status==="live")text.push("⚠️ 外部Roomで通話を終了しても、こちらの募集は自動終了しません。終了時は必ず下の「✅ 終了する」を押してください。");
 const rows:Array<Array<ReturnType<typeof Markup.button.callback>|ReturnType<typeof Markup.button.url>>>=[];
 // Telegram cannot attach a callback directly to a word in the message body.
 // Keep its existing edit callback immediately below the displayed text,
 // rather than mixing it into the three primary management actions.
 if(!["finished","cancelled"].includes(p.status))
  rows.push([colored("✏️ 編集",`room:published:edit:${p.announcementId}`,"primary")]);
 if(["draft","scheduled","ready","postponed"].includes(p.status)){
  const primary=[
   colored("▶ 開始して入室",`room:published:start:${p.announcementId}:${p.roomRevision}`,"success"),
   ...(p.visibility==="approved_only"?[
    colored("👥 応募者を見る",`room:published:applicants:${p.announcementId}`,"primary")
   ]:[]),
   colored("🗑 削除",`room:published:delete:${p.announcementId}`,"danger"),
  ];
  rows.push(primary);
 }else if(p.status==="live"){
  rows.push([
   colored("✅ 終了する",`room:published:finish:${p.announcementId}:${p.roomRevision}`,"danger"),
   ...(p.visibility==="approved_only"?[
    colored("👥 応募者を見る",`room:published:applicants:${p.announcementId}`,"primary")
   ]:[]),
   colored("🗑 削除",`room:published:delete:${p.announcementId}`,"danger"),
  ]);
 }
 // Cross-post order is original verified Topic first, same-group ROOM Topic second.
 // Navigate to the actual Topic thread, not to an arbitrary post/message receipt.
 const dest=p.destinations??[];
 if(dest.length){
  const origin=dest[0]!;
  const dedicated=dest.find(d=>d.chatId===origin.chatId&&d.threadId!==origin.threadId);
  if(origin.threadId>0&&Number.isSafeInteger(origin.threadId)){
   const nav=[Markup.button.url("🔗 投稿先へ戻る",
    telegramPublishedMessageUrl(origin.chatId,origin.threadId))];
   if(dedicated&&Number.isSafeInteger(dedicated.threadId)&&dedicated.threadId>0)
    nav.push(Markup.button.url("🎬 専用トピックを開く",
     telegramPublishedMessageUrl(dedicated.chatId,dedicated.threadId)));
   rows.push(nav);
  }
 }
 return {text:text.join("\n"),keyboard:Markup.inlineKeyboard(rows)};
}

/** A published receipt may outlive a disabled posting destination.
 * Deletion must be possible without re-enabling a route, but only in the
 * original known community and with a valid stored Telegram message ID. */
export function assertRoomDeletionReceipt(row:{
 board_key:string;purpose:string;chat_id:unknown;
 message_thread_id:unknown;telegram_message_id:unknown;
}):void{
 const board=row.board_key as BoardKey;
 const chatId=Number(row.chat_id),threadId=Number(row.message_thread_id);
 const messageId=Number(row.telegram_message_id);
 if(!Object.prototype.hasOwnProperty.call(BOARD_GROUP_CHAT_IDS,board)||
    BOARD_GROUP_CHAT_IDS[board]!==chatId||
    !["room","announcement"].includes(row.purpose)||
    !Number.isSafeInteger(threadId)||threadId<=0||
    !Number.isSafeInteger(messageId)||messageId<=0)
  throw Error("ROOM_DELETE_TOPIC_STALE");
}
/** Reuse MPB's Telegram dispatcher and its existing per-destination receipts.
 * An uncertain delete is never automatically repeated and each successful
 * destination remains recorded, even if another destination fails.
 */
export async function deletePublishedRoom(telegram:Telegram,owner:number,
 announcementId:number,expectedRevision:number):Promise<void>{
 const pub=await loadRoomPublication(owner,announcementId);
 if(pub.roomRevision!==expectedRevision||
   ["finished","cancelled"].includes(pub.status))
  throw Error("ROOM_DELETE_STALE");
 const rows=await pool.query(
  `SELECT d.delivery_id,d.posting_topic_id,d.telegram_message_id,
          t.board_key,t.purpose,t.chat_id,t.message_thread_id
    FROM posting_deliveries d
    JOIN posting_topics t ON t.topic_id=d.posting_topic_id
    WHERE d.source_type='announcement' AND d.source_id=$1
      AND d.owner_user_id=$2 AND d.status='sent'
      AND d.telegram_message_id IS NOT NULL
    ORDER BY d.delivery_id`,[String(announcementId),owner]);
 if(!rows.rows.length)throw Error("ROOM_DELETE_RECEIPT_MISSING");
 for(const x of rows.rows)assertRoomDeletionReceipt(x);
 const claim=await pool.query(
  `UPDATE announcement_posts SET status='publishing',updated_at=NOW()
   WHERE announcement_id=$1 AND owner_user_id=$2 AND status='published'
     AND room_id=$3 RETURNING announcement_id`,
  [announcementId,owner,pub.roomId]);
 if(claim.rows.length!==1)throw Error("ROOM_DELETE_ALREADY_PROCESSING");
 try{
  for(const x of rows.rows){
   await createTelegramDispatcher(telegram).cancel({
    chatId:Number(x.chat_id),threadId:Number(x.message_thread_id)
   },Number(x.telegram_message_id));
   const done=await pool.query(
    `UPDATE posting_deliveries SET status='deleted',updated_at=NOW()
      WHERE delivery_id=$1 AND owner_user_id=$2 AND status='sent'
      RETURNING delivery_id`,[Number(x.delivery_id),owner]);
   if(done.rows.length!==1)throw Error("ROOM_DELETE_ACK_UNCERTAIN");
  }
  await updateRoomState(owner,pub.roomId,expectedRevision,"cancel");
  const finalized=await pool.query(
   `UPDATE announcement_posts SET status='cancelled',
      accept_applications=FALSE,updated_at=NOW()
    WHERE announcement_id=$1 AND owner_user_id=$2 AND status='publishing'
    RETURNING announcement_id`,
   [announcementId,owner]);
  if(finalized.rows.length!==1)throw Error("ROOM_DELETE_FINALIZE_UNCERTAIN");
 }catch(error){
  // Existing deleted receipts must not be sent or deleted a second time.
  await pool.query(
   `UPDATE announcement_posts SET status='needs_reconcile',
     accept_applications=FALSE,updated_at=NOW()
     WHERE announcement_id=$1 AND owner_user_id=$2 AND status='publishing'`,
   [announcementId,owner]).catch(()=>{});
  throw error;
 }
}
