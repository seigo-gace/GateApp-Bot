import type {VerifiedTopic} from "./topicRouting.js";
import {assertVerifiedTopic} from "./topicRouting.js";

type CreatorIdentity={id:number|null;username:string;is_bot:true};
const MASTER_FIXED_STICKER_BOT_USERNAME="CreateVdobot";
function approvedUsername(name:string):string{
 if(name.toLowerCase()!==MASTER_FIXED_STICKER_BOT_USERNAME.toLowerCase())
  throw new Error("STICKER_PIN_TARGET_USERNAME_UNAPPROVED");
 return MASTER_FIXED_STICKER_BOT_USERNAME;
}
function fixedCreatorIdentity(name:string):CreatorIdentity{
 // A user-approved deep-link destination is public configuration, NOT a
 // Telegram Bot-API identity attestation. No sales-bot token is needed.
 return {id:null,username:approvedUsername(name),is_bot:true};
}
type CreatorBotApi=(method:string,params:Record<string,unknown>)=>Promise<unknown>;
type PinRow={topic_id:number;creator_bot_id:number|null;creator_bot_username:string;
 status:string;telegram_message_id:number|null};
type Database={query(sql:string,args:unknown[]):Promise<{rowCount:number|null;rows:Record<string,unknown>[]}>};
function requireIdentity(value:unknown):CreatorIdentity{
 const id=value as Partial<CreatorIdentity>|null;
 if(id?.is_bot!==true||!Number.isSafeInteger(id.id)||Number(id.id)<=0||
    typeof id.username!=="string"||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(id.username))
  throw new Error("STICKER_PIN_CREATOR_IDENTITY_UNVERIFIED");
 return {id:id.id!,username:id.username!,is_bot:true};
}
function stickerTopic(t:VerifiedTopic & {groupTitle?:string;verified?:boolean}){
 assertVerifiedTopic(t,"video_chat","sticker");
 if(t.chatId!==-1002373696859||t.title!=="ステッカーの公開と販売"||
    t.groupTitle!=="ビデオChatの掲示板"||t.verified!==true)
  throw new Error("STICKER_PIN_TOPIC_NOT_VERIFIED");
 return t;
}
function row(raw:Record<string,unknown>):PinRow{
 return {topic_id:Number(raw.topic_id),creator_bot_id:raw.creator_bot_id===null?null:Number(raw.creator_bot_id),
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
   if(!existing||
      (bot.id!==null&&existing.creator_bot_id!==null&&
       existing.creator_bot_id!==bot.id)||
      existing.creator_bot_username.toLowerCase()!==bot.username.toLowerCase())
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
 getVerifiedStickerTopic,creatorBotApi,creatorBotUsername,postingBotApi,store
}:{
 getVerifiedStickerTopic:()=>Promise<VerifiedTopic & {groupTitle?:string;verified?:boolean}>;
 // Optional strong proof when the owner has an already-mounted Creator
 // credential; no new secret required for the user-approved public URL.
 creatorBotApi?:CreatorBotApi;
 creatorBotUsername?:string;
 // GateApp-Bot is the existing group administrator and owns the pin.
 postingBotApi:CreatorBotApi;
 store:ReturnType<typeof createStickerEntryPinStore>;
}){
 if(typeof getVerifiedStickerTopic!=="function"||
   typeof postingBotApi!=="function"||typeof store?.claim!=="function"||
   (typeof creatorBotApi==="function"&&creatorBotUsername!==undefined)||
   (typeof creatorBotApi!=="function"&&creatorBotUsername===undefined))
  throw new Error("STICKER_PIN_OWNER_DEPS_MISSING");
 return async function ensureStickerEntryPin(){
  const t=stickerTopic(await getVerifiedStickerTopic());
  const bot=creatorBotApi?
   requireIdentity(await creatorBotApi("getMe",{})):
   fixedCreatorIdentity(creatorBotUsername!);
  // Only the target DM account is pinned to the Master-approved name.
  // The sending GroupBot is independently checked by getChatMember.
  bot.username=approvedUsername(bot.username);
  const writer=requireIdentity(await postingBotApi("getMe",{}));
  const rights=await postingBotApi("getChatMember",{
    chat_id:t.chatId,user_id:writer.id});
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
   const sent=await postingBotApi("sendMessage",{
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
   if(await postingBotApi("pinChatMessage",{
     chat_id:t.chatId,message_id:msgId,disable_notification:true
   })!==true)throw new Error("STICKER_PIN_API_NOT_CONFIRMED");
   await store.pinnedAck(t.id);
  }catch(e){await store.unknown(t.id).catch(()=>{});throw e;}
  return {acknowledged:true,readbackVerified:false,alreadySubmitted:false,messageId:msgId};
 };
}
