/** Owner-scoped published Room+募集 editor. ROOM owns meeting state, its linked
 * recruitment announcement owns the group post, MPB owns message IDs.
 * Never copy or re-send a public post when opening its management screen.
 */
import {pool} from "../db/index.js";
import {Markup} from "telegraf";
import {styledInlineButton as colored} from "./inlineButtonStyle.js";
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
 destinations?:{chatId:number;messageId:number;topicTitle:string}[];
};
export async function loadRoomPublication(owner:number,announcementId:number):Promise<RoomPublication>{
 if(![owner,announcementId].every(n=>Number.isSafeInteger(n)&&n>0))
  throw Error("ROOM_PUBLICATION_OWNER_INVALID");
 const r=await pool.query(`
  SELECT a.announcement_id,a.room_id,r.revision AS room_revision,
   r.title,r.description,r.status,r.join_visibility,r.start_at,r.join_url,
   t.board_key,t.title AS topic_title,t.chat_id,d.telegram_message_id
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
   chatId:n(row.chat_id),messageId:n(row.telegram_message_id),
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
  finished:"⚫ 終了",
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
 const rows:Array<Array<ReturnType<typeof Markup.button.callback>|ReturnType<typeof Markup.button.url>>>=[];
 if(["draft","scheduled","ready","postponed"].includes(p.status)){
  rows.push([
   colored("▶ 開始する",`room:published:start:${p.announcementId}:${p.roomRevision}`,"success"),
   colored("✏️ 編集",`room:published:edit:${p.announcementId}`,"primary"),
   colored("🗑 削除",`room:published:delete:${p.announcementId}`,"danger")
  ]);
 }else if(p.status==="live"){
  rows.push([
   colored("⚫ 終了",`room:published:finish:${p.announcementId}:${p.roomRevision}`,"danger"),
   colored("✏️ 編集",`room:published:edit:${p.announcementId}`,"primary"),
   colored("🗑 削除",`room:published:delete:${p.announcementId}`,"danger")
  ]);
 }
 if(p.status==="live"&&p.ownerJoinUrl)rows.push([
  Markup.button.url("🎥 ROOMに入る",p.ownerJoinUrl)]);
 for(const [i,destination] of (p.destinations??[
  {chatId:p.chatId,messageId:p.messageId,topicTitle:p.topicTitle}]).entries()){
  rows.push([Markup.button.url((i===0?"📍 元の投稿先":"🎬 ビデオチャット投稿先")+"を開く",
   telegramPublishedMessageUrl(destination.chatId,destination.messageId))]);
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
