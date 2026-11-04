import type { Telegram } from "telegraf";
import { getVerifiedTopic, claimDelivery, acknowledgeDelivery, markDeliveryUnknown } from "./postingDelivery.js";
import type { PostPurpose } from "./topicRouting.js";

export type PublishRequest = {
  sourceType:PostPurpose;
  destinationPurpose?:PostPurpose;
  sourceId:string;
  ownerId:number;
  revision:number;
  topicId:number;
  text:string;
  approved:boolean;
};

/** Shared MPB-facing Telegram adapter. No business state is owned here. */
export async function publishPost(telegram:Telegram, req:PublishRequest):
  Promise<{messageId:number;chatId:number;threadId:number}> {
  if(req.approved!==true)throw new Error("PUBLISH_CONSENT_REQUIRED");
  if(!req.sourceId||req.sourceId.length>120||!req.text.trim()||req.text.length>4096)
    throw new Error("PUBLISH_INPUT_INVALID");
  const topic=await getVerifiedTopic(req.topicId,req.destinationPurpose||req.sourceType);
  const chat=await telegram.getChat(topic.chatId);
  if(chat.id!==topic.chatId||chat.type!=="supergroup")
    throw new Error("PUBLISH_CHAT_UNVERIFIED");
  const self=await telegram.getMe();
  const membership=await telegram.getChatMember(topic.chatId,self.id);
  if(membership.status!=="administrator"&&membership.status!=="creator")
    throw new Error("PUBLISH_BOT_NOT_ADMIN");
  const claimed=await claimDelivery(
   req.sourceType,req.sourceId,req.ownerId,req.revision,topic.id
  );
  if(!claimed.claimed){
   if(claimed.delivery.status==="sent"&&claimed.delivery.messageId)
    return {messageId:claimed.delivery.messageId,chatId:topic.chatId,threadId:topic.threadId};
   throw new Error("PUBLISH_NEEDS_RECONCILE");
  }
  try{
   const sent=await telegram.sendMessage(topic.chatId,req.text,{
     message_thread_id:topic.threadId,parse_mode:"HTML",
   });
   await acknowledgeDelivery(claimed.delivery.id,sent.message_id);
   return {messageId:sent.message_id,chatId:topic.chatId,threadId:topic.threadId};
  }catch(error){
   // An API timeout may mean Telegram already accepted the message.
   // Never send a second copy without explicit reconciliation.
   await markDeliveryUnknown(claimed.delivery.id);
   throw error;
  }
}
