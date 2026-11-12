import type { Telegram } from "telegraf";
import { createTelegramDispatcher } from "./telegramDispatcher.js";
import { pool } from "../db/index.js";
import { getVerifiedTopic, claimDelivery, acknowledgeDelivery, markDeliveryUnknown } from "./postingDelivery.js";
import type { PostPurpose } from "./topicRouting.js";

/** The same feature gate protects first publish and edit-in-place. */
export async function assertFeatureReleased(feature:PostPurpose):Promise<void>{
 const gate=await pool.query(
   `SELECT feature FROM gaybbs_feature_release_gates
    WHERE feature=$1 AND enabled=TRUE AND length(source_commit)=40
      AND length(trim(ci_evidence))>0
      AND length(trim(gserver_runtime_evidence))>0
      AND length(trim(telegram_e2e_evidence))>0
      AND approved_by IS NOT NULL`,[feature]);
 if(gate.rows.length!==1)throw new Error("FEATURE_RELEASE_NOT_VERIFIED");

}

export type PublishRequest = {
  sourceType:PostPurpose;
  destinationPurpose?:PostPurpose;
  sourceId:string;
  ownerId:number;
  revision:number;
  topicId:number;
  text:string;
  buttons?:readonly (readonly {text:string;url:string}[])[];
  approved:boolean;
};

/** Shared MPB-facing Telegram adapter. No business state is owned here. */
export async function publishPost(telegram:Telegram, req:PublishRequest):
  Promise<{messageId:number;chatId:number;threadId:number}> {
  if(req.approved!==true)throw new Error("PUBLISH_CONSENT_REQUIRED");
  if(!req.sourceId||req.sourceId.length>120||!req.text.trim()||req.text.length>4096)
    throw new Error("PUBLISH_INPUT_INVALID");
  // Direct /publish command must not bypass the same release evidence gate
  // used by the pinned M2 menu. Source/CI alone is not public acceptance.
  const feature=req.destinationPurpose||req.sourceType;
  await assertFeatureReleased(feature);
  const topic=await getVerifiedTopic(req.topicId,req.destinationPurpose||req.sourceType);
  const chat=await telegram.getChat(topic.chatId);
  if(chat.id!==topic.chatId||chat.type!=="supergroup")
    throw new Error("PUBLISH_CHAT_UNVERIFIED");
  const self=await telegram.getMe();
  const membership=await telegram.getChatMember(topic.chatId,self.id);
  if(membership.status!=="administrator"&&membership.status!=="creator")
    throw new Error("PUBLISH_BOT_NOT_ADMIN");
  const claimed=await claimDelivery(
   req.sourceType,req.sourceId,req.ownerId,req.revision,topic.id,req.buttons||[]
  );
  if(!claimed.claimed){
   if(claimed.delivery.status==="sent"&&claimed.delivery.messageId)
    return {messageId:claimed.delivery.messageId,chatId:topic.chatId,threadId:topic.threadId};
   throw new Error("PUBLISH_NEEDS_RECONCILE");
  }
  try{
   const messageId=await createTelegramDispatcher(telegram).publish(
    {chatId:topic.chatId,threadId:topic.threadId},
    {text:req.text,parseMode:"HTML",buttons:req.buttons});
   await acknowledgeDelivery(claimed.delivery.id,messageId,req.text);
   return {messageId,chatId:topic.chatId,threadId:topic.threadId};
  }catch(error){
   // An API timeout may mean Telegram already accepted the message.
   // Never send a second copy without explicit reconciliation.
   await markDeliveryUnknown(claimed.delivery.id);
   throw error;
  }
}
