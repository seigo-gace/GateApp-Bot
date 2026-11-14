/** One deliberate profile save publishes to the three existing verified
 * "みんなのプロフ" topics. Never guess a thread ID or replay an
 * uncertain delivery. Subsequent saves edit the original post in place.
 */
import type {Telegram} from "telegraf";
import {BOARD_KEYS,BOARD_GROUP_CHAT_IDS} from "./topicRouting.js";
import {listVerifiedTopics} from "./postingDelivery.js";
import {assertFeatureReleased,publishPost} from "./publishService.js";
import {makeProfileViewerButtons} from "./profilePublicView.js";
import {recordProfilePublication,listProfilePublications,type SavedProfile} from "./profileRepository.js";
import {revisePublishedProfile} from "./profilePublicationUpdate.js";
import {renderPublicProfile} from "./profileCore.js";

export async function profileBoardDestinations(){
 const topics=await listVerifiedTopics("profile");
 const destinations=BOARD_KEYS.map(board=>{
  const matches=topics.filter(t=>t.board===board&&
   t.chatId===BOARD_GROUP_CHAT_IDS[board]&&t.title.includes("みんなのプロフ"));
  if(matches.length!==1)throw Error("PROFILE_BOARD_DESTINATION_NOT_VERIFIED:"+board);
  return matches[0]!;
 });
 if(new Set(destinations.map(t=>t.chatId+":"+t.threadId)).size!==3)
  throw Error("PROFILE_BOARD_DESTINATION_DUPLICATED");
 return destinations;
}

export async function publishProfileToAllBoards(
 telegram:Telegram,ownerId:number,profile:SavedProfile
):Promise<{published:number;updated:number;unchanged:number}>{
 // Check *every* destination before the first Telegram side effect.
 const destinations=await profileBoardDestinations();
 await assertFeatureReleased("profile");
 const pubs=await listProfilePublications(ownerId);
 for(const destination of destinations){
  const existing=pubs.find(p=>p.chatId===destination.chatId&&p.threadId===destination.threadId);
  if(existing&&existing.status!=="published")
   throw Error("PROFILE_PUBLICATION_NEEDS_RECONCILE");
 }
 let published=0,updated=0,unchanged=0;
 for(const topic of destinations){
  const existing=pubs.find(p=>p.chatId===topic.chatId&&p.threadId===topic.threadId);
  if(existing){
   const result=await revisePublishedProfile(telegram,ownerId,profile,topic.id);
   if(!result)throw Error("PROFILE_PUBLICATION_STATE_CHANGED");
   if(result.updated)updated++;else unchanged++;
   continue;
  }
  const buttons=await makeProfileViewerButtons(ownerId,profile.revision,topic.id);
  const delivered=await publishPost(telegram,{
   sourceType:"profile",sourceId:String(ownerId),ownerId,revision:profile.revision,
   topicId:topic.id,text:renderPublicProfile(profile),buttons,approved:true
  });
  // If recording fails, the delivery ledger prevents a blind duplicate.
  await recordProfilePublication(ownerId,profile.revision,
   delivered.chatId,delivered.threadId,delivered.messageId,profile);
  published++;
 }
 return {published,updated,unchanged};
}
