import type {VerifiedTopic} from "./topicRouting.js";
import {assertVerifiedTopic} from "./topicRouting.js";

type CreatorIdentity={id:number;username:string;is_bot:boolean};
type CreatorBotApi=(method:string,params:Record<string,unknown>)=>Promise<unknown>;
type PinRow={topic_id:number;creator_bot_id:number;creator_bot_username:string;
 status:string;telegram_message_id:number|null};
type Database={query(sql:string,args:unknown[]):Promise<{rowCount:number|null;rows:Record<string,unknown>[]}>};
function requireIdentity(value:unknown):CreatorIdentity{
 const id=value as Partial<CreatorIdentity>|null;
 if(id?.is_bot!==true||!Number.isSafeInteger(id.id)||Number(id.id)<=0||
    typeof id.username!=="string"||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(id.username))
  throw new Error("STICKER_PIN_CREATOR_IDENTITY_UNVERIFIED");
 return id as CreatorIdentity;
}
function stickerTopic(t:VerifiedTopic & {groupTitle?:string;verified?:boolean}){
 assertVerifiedTopic(t,"video_chat","sticker");
 if(t.chatId!==-1002373696859||t.title!=="ステッカーの公開と販売"||
    t.groupTitle!=="ビデオChatの掲示板"||t.verified!==true)
  throw new Error("STICKER_PIN_TOPIC_NOT_VERIFIED");
 return t;
}
function row(raw:Record<string,unknown>):PinRow{
 return {topic_id:Number(raw.topic_id),creator_bot_id:Number(raw.creator_bot_id),
  creator_bot_username:String(raw.creator_bot_username),status:String(raw.status),
  telegram_message_id:raw.telegram_message_id==null?null:Number(raw.telegram_message_id)};
}
/** GateApp-Bot owns the pinned-entry receipt. A result-unknown call must never
 * create a second entry message merely because the response was lost.
 */
export function createStickerEntryPinStore(db:Database){
 if(typeof db?.query!=="function")throw new Error("STICKER_PIN_DB_REQUIRED");
 return {
  async read(topicId:number):Promise<PinRow|null>{
   const q=await db.query(
    "SELECT topic_id,creator_bot_id,creator_bot_username,status,telegram_message_id"+
    " FROM posting_sticker_entry_pins WHERE topic_id=$1",[topicId]);
   return q.rows[0]?row(q.rows[0]):null;
  },
  async claim(t:VerifiedTopic,bot:CreatorIdentity){
   const q=await db.query(
    "INSERT INTO posting_sticker_entry_pins"+
    " (topic_id,creator_bot_id,creator_bot_username,status)"+
    " SELECT $1,$2,$3,'sending' WHERE EXISTS"+
    " (SELECT 1 FROM posting_topics WHERE topic_id=$1 AND board_key='video_chat'"+
    " AND purpose='sticker' AND enabled=TRUE AND verified_by IS NOT NULL"+
    " AND verified_at IS NOT NULL AND chat_id=$4 AND message_thread_id=$5"+
    " AND title=$6) ON CONFLICT (topic_id) DO NOTHING RETURNING topic_id",
    [t.id,bot.id,bot.username,t.chatId,t.threadId,t.title]);
   if(q.rowCount===1)return {claimed:true};
   const existing=await this.read(t.id);
   if(!existing||existing.creator_bot_id!==bot.id||
      existing.creator_bot_username!==bot.username)
    throw new Error("STICKER_PIN_EXISTING_OWNER_MISMATCH");
   return {claimed:false,status:existing.status,messageId:existing.telegram_message_id};
  },
  async sent(topicId:number,messageId:number){
   const q=await db.query(
    "UPDATE posting_sticker_entry_pins SET status='sent',telegram_message_id=$2,"+
    " updated_at=NOW() WHERE topic_id=$1 AND status='sending' RETURNING topic_id",
    [topicId,messageId]);
   if(q.rowCount!==1)throw new Error("STICKER_PIN_SENT_RECEIPT_CONFLICT");
  },
  async beginPin(topicId:number){
   const q=await db.query(
    "UPDATE posting_sticker_entry_pins SET status='pin_requested',updated_at=NOW()"+
    " WHERE topic_id=$1 AND status='sent' RETURNING telegram_message_id",
    [topicId]);
   if(q.rowCount!==1)throw new Error("STICKER_PIN_MUTATION_CAS_FAILED");
   return Number(q.rows[0].telegram_message_id);
  },
  async pinnedAck(topicId:number){
   const q=await db.query(
    "UPDATE posting_sticker_entry_pins SET status='pinned_ack',updated_at=NOW()"+
    " WHERE topic_id=$1 AND status='pin_requested' RETURNING topic_id",[topicId]);
   if(q.rowCount!==1)throw new Error("STICKER_PIN_ACK_NOT_SAVED");
  },
  async unknown(topicId:number){
   await db.query(
    "UPDATE posting_sticker_entry_pins SET status='needs_reconcile',updated_at=NOW()"+
    " WHERE topic_id=$1 AND status IN ('sending','sent','pin_requested')",[topicId]);
  }
 };
}
export function createStickerEntryPinService({
 getVerifiedStickerTopic,creatorBotApi,store
}:{
 getVerifiedStickerTopic:()=>Promise<VerifiedTopic & {groupTitle?:string;verified?:boolean}>;
 creatorBotApi:CreatorBotApi;
 store:ReturnType<typeof createStickerEntryPinStore>;
}){
 if(typeof getVerifiedStickerTopic!=="function"||
   typeof creatorBotApi!=="function"||typeof store?.claim!=="function")
  throw new Error("STICKER_PIN_OWNER_DEPS_MISSING");
 return async function ensureStickerEntryPin(){
  const t=stickerTopic(await getVerifiedStickerTopic());
  const bot=requireIdentity(await creatorBotApi("getMe",{}));
  const rights=await creatorBotApi("getChatMember",{chat_id:t.chatId,user_id:bot.id});
  const membership=rights as {status?:string;can_pin_messages?:boolean}|null;
  if(!membership||!["administrator","creator"].includes(String(membership.status))||
    (membership.status==="administrator"&&membership.can_pin_messages!==true))
   throw new Error("STICKER_PIN_BOT_ADMIN_REQUIRED");
  const claim=await store.claim(t,bot);
  if(!claim.claimed){
   // An ACK is not an independent Telegram pinned-message readback.
   if(claim.status==="pinned_ack")
    return {acknowledged:true,readbackVerified:false,alreadySubmitted:true,
     messageId:claim.messageId};
   throw new Error("STICKER_PIN_RECEIPT_NEEDS_RECONCILE");
  }
  let msgId:number;
  try{
   const sent=await creatorBotApi("sendMessage",{
    chat_id:t.chatId,message_thread_id:t.threadId,
    text:"📌 投稿はこちら\nステッカー・カスタム絵文字の作成、パック管理、販売はBotのDMで操作してください。",
    reply_markup:{inline_keyboard:[[{text:"🎨 投稿はこちら",
      url:"https://t.me/"+bot.username+"?start=sticker"}]]}
   }) as {message_id?:number}|null;
   if(!Number.isSafeInteger(sent?.message_id)||Number(sent?.message_id)<=0)
    throw new Error("STICKER_PIN_MESSAGE_UNVERIFIED");
   msgId=Number(sent!.message_id);
   await store.sent(t.id,msgId);
  }catch(e){await store.unknown(t.id).catch(()=>{});throw e;}
  try{
   const pinned=await store.beginPin(t.id);
   if(pinned!==msgId)throw new Error("STICKER_PIN_RECEIPT_MISMATCH");
   if(await creatorBotApi("pinChatMessage",{
     chat_id:t.chatId,message_id:msgId,disable_notification:true
   })!==true)throw new Error("STICKER_PIN_API_NOT_CONFIRMED");
   await store.pinnedAck(t.id);
  }catch(e){await store.unknown(t.id).catch(()=>{});throw e;}
  return {acknowledged:true,readbackVerified:false,alreadySubmitted:false,messageId:msgId};
 };
}
