/** Owner-scoped published Room+募集 editor. ROOM owns meeting state, its linked
 * recruitment announcement owns the group post, MPB owns message IDs.
 * Never copy or re-send a public post when opening its management screen.
 */
import {pool} from "../db/index.js";
import {Markup} from "telegraf";
import {BOARD_TITLES,type BoardKey} from "./topicRouting.js";
import {telegramPublishedMessageUrl} from "./searchDomain.js";

export type RoomPublication={
 announcementId:number;roomId:number;roomRevision:number;
 groupTitle:string;topicTitle:string;chatId:number;messageId:number;
 title:string;description:string;status:string;visibility:string;
 scheduledAt:string|null;ownerJoinUrl:string|null;
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
   AND a.status='published'
  ORDER BY d.delivery_id DESC LIMIT 1`,[owner,announcementId]);
 if(r.rows.length!==1)throw Error("ROOM_PUBLICATION_NOT_OWNED_OR_UNCONFIRMED");
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
 };
 if(![data.announcementId,data.roomId,data.roomRevision,data.messageId].every(
  x=>Number.isSafeInteger(x)&&x>0))throw Error("ROOM_PUBLICATION_RECEIPT_INVALID");
 telegramPublishedMessageUrl(data.chatId,data.messageId);
 return data;
}
export function roomPublicationEditor(p:RoomPublication){
 const state:Record<string,string>={
  draft:"作成中",scheduled:"📅 予告中",ready:"🟢 準備完了",
  live:"🔴 LIVE中",postponed:"⏸ 延期",cancelled:"🚫 中止",
  finished:"⚫ 終了しました",
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
 const rows:Array<Array<ReturnType<typeof Markup.button.callback>|ReturnType<typeof Markup.button.url>>>=[
  [Markup.button.callback("✏️ タイトル・説明を編集",`room:published:edit:${p.announcementId}`)],
 ];
 if(p.status==="live")rows.push([
  Markup.button.callback("⚫ 終了する",`room:published:finish:${p.announcementId}:${p.roomRevision}`)]);
 else if(["scheduled","ready","postponed"].includes(p.status))rows.push([
  Markup.button.callback("🚫 中止する",`room:published:cancel:${p.announcementId}:${p.roomRevision}`)]);
 if(p.status==="live"&&p.ownerJoinUrl)rows.push([
  Markup.button.url("🎥 ROOMに入る",p.ownerJoinUrl)]);
 rows.push([Markup.button.url("📍 投稿先を開く",
  telegramPublishedMessageUrl(p.chatId,p.messageId))]);
 return {text:text.join("\n"),keyboard:Markup.inlineKeyboard(rows)};
}
