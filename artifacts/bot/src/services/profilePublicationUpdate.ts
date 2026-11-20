/** Source-owned revision sync. Updates the original Telegram post, never
 * creates another one, and leaves ambiguous API outcomes for reconciliation.
 */
import type {Telegram} from "telegraf";
import {getVerifiedTopic} from "./postingDelivery.js";
import {createTelegramDispatcher} from "./telegramDispatcher.js";
import {assertFeatureReleased} from "./publishService.js";
import {makeProfileViewerButtons} from "./profilePublicView.js";
import {claimProfileRevisionUpdate,recordProfilePublication,
  listProfilePublications,type SavedProfile} from "./profileRepository.js";
import {renderPublicProfile} from "./profileCore.js";

export async function revisePublishedProfile(
 telegram:Telegram,ownerId:number,profile:SavedProfile,topicId:number,
):Promise<{updated:boolean;chatId:number;threadId:number;messageId:number}|null>{
 const topic=await getVerifiedTopic(topicId,"profile");
 const pubs=await listProfilePublications(ownerId);
 const existing=pubs.find(p=>p.chatId===topic.chatId&&p.threadId===topic.threadId);
 if(!existing)return null; // First publish handled by the shared MPB path.
 if(existing.status!=="published"||!Number.isSafeInteger(existing.messageId)||
    existing.messageId<=0)throw Error("PROFILE_PUBLICATION_NEEDS_RECONCILE");
 if(existing.syncedRevision===profile.revision)return{
  updated:false,chatId:topic.chatId,threadId:topic.threadId,messageId:existing.messageId,
 };
 if(existing.syncedRevision>profile.revision)throw Error("PROFILE_PUBLICATION_STALE");
 // Do not evade the first-publication release evidence or Telegram rights checks.
 await assertFeatureReleased("profile");
 const chat=await telegram.getChat(topic.chatId);
 if(chat.id!==topic.chatId||chat.type!=="supergroup")
  throw Error("PUBLISH_CHAT_UNVERIFIED");
 const me=await telegram.getMe();
 const member=await telegram.getChatMember(topic.chatId,me.id);
 if(member.status!=="administrator"&&member.status!=="creator")
  throw Error("PUBLISH_BOT_NOT_ADMIN");
 // Prepare a stable link and the new exact public message before claiming.
 const buttons=await makeProfileViewerButtons(ownerId,profile.revision,topicId);
 const text=renderPublicProfile(profile);
 const messageId=await claimProfileRevisionUpdate(ownerId,profile.revision,topic.chatId,topic.threadId);
 try{
  await createTelegramDispatcher(telegram).revise(
   {chatId:topic.chatId,threadId:topic.threadId},messageId,
   {text,parseMode:"HTML",buttons});
 }catch{
  // Failed / timed-out edit may already have been applied on Telegram.
  // Never retry automatically or make a second post with the new revision.
  throw Error("PROFILE_PUBLICATION_UPDATE_NEEDS_RECONCILE");
 }
 // If the DB fails now, status stays sync_error and requires evidence readback.
 await recordProfilePublication(ownerId,profile.revision,topic.chatId,topic.threadId,messageId,profile);
 return {updated:true,chatId:topic.chatId,threadId:topic.threadId,messageId};
}
