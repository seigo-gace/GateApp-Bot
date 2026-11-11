/** Room+募集 cross-post plan: original verified Topic plus the sole verified
 * ROOM Topic in the SAME group. Never infer a thread ID from a message link.
 * Both deliveries share one announcement source ID and independent MPB receipts.
 */
import type {VerifiedTopic} from "./topicRouting.js";
export type RoomTarget={topicId:number;purpose:"room"|"announcement";chatId:number;threadId:number;title:string};
export function roomCrossPostTargets(
 roomTopics:readonly VerifiedTopic[],recruitmentTopics:readonly VerifiedTopic[],
 origin:{chatId:number;threadId:number}|null
):RoomTarget[]{
 if(!origin)throw Error("ROOM_ORIGIN_NOT_VERIFIED");
 const matches=[...roomTopics,...recruitmentTopics].filter(t=>
  t.enabled&&t.chatId===origin.chatId&&t.threadId===origin.threadId);
 if(matches.length!==1)throw Error("ROOM_ORIGIN_AMBIGUOUS_OR_NOT_VERIFIED");
 const source=matches[0]!;
 // Never migrate a recruitment from one community into another community.
 // Use the already verified recruitment posting registry for ROOM, too.
 // The three ONLINE thread IDs were independently Bot-API verified in
 // deploy/online-topic-verified.json. Never create a parallel ROOM registry.
 const onlineThreads:Record<string,number>={
  area_bbs:116,video_chat:1605,gay_board:4,
 };
 const requiredThread=onlineThreads[source.board];
 const online=[...roomTopics,...recruitmentTopics].filter(t=>t.enabled&&
  t.board===source.board&&t.chatId===source.chatId&&
  t.threadId===requiredThread);
 // One Telegram destination can have two purpose registrations. Prefer the
 // already verified recruitment entry, which is the adopted shared route.
 const announcements=online.filter(t=>t.purpose==="announcement");
 const candidates=announcements.length?announcements:online;
 if(candidates.length!==1)throw Error("ROOM_ONLINE_DESTINATION_NOT_VERIFIED");
 const video=candidates[0]!;
 const make=(t:VerifiedTopic):RoomTarget=>({
  topicId:t.id,purpose:t.purpose==="room"?"room":"announcement",
  chatId:t.chatId,threadId:t.threadId,title:t.title,
 });
 const original=make(source),cross=make(video);
 return original.chatId===cross.chatId&&original.threadId===cross.threadId?
  [original]:[original,cross];
}
