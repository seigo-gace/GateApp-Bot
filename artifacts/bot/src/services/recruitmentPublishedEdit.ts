import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {getProfile} from "./profileRepository.js";
import {renderRecruitmentCard,recruitmentExtras,validateRecruitmentReady,type RecruitmentInput} from "./recruitmentCompose.js";
import {getVerifiedTopic} from "./postingDelivery.js";
import {assertFeatureReleased} from "./publishService.js";
import {createTelegramDispatcher} from "./telegramDispatcher.js";
import {validLikeTags} from "./profileLike.js";
import {ensureRecruitmentViewToken,recruitmentIdentitySnapshot,legacyRecruitmentIdentity,recruitmentInputFromRow,recruitmentViewRows,verifiedRecruitmentUsername,RECRUITMENT_UI_VERSION} from "./recruitmentPublicView.js";
import type {ProfileBasicDraft} from "./profileCore.js";

export type PublishedRecruitment={
 sourceId:number;sourceRevision:number;
 topicId:number;chatId:number;threadId:number;messageId:number;
 input:RecruitmentInput;
 snapshot:ProfileBasicDraft|null;
};
const validId=(v:number)=>Number.isSafeInteger(v)&&v>0;
export async function loadPublishedRecruitment(owner:number,sourceId:number):Promise<PublishedRecruitment>{
 if(!validId(owner)||!validId(sourceId))throw Error("RECRUITMENT_PUBLICATION_INVALID");
 const r=await pool.query(
  "SELECT a.announcement_id,a.revision,a.text,a.conditions,a.profile_snapshot,a.purpose_codes,a.place_codes,"+
  " d.telegram_message_id,d.rendered_text,d.posting_topic_id,t.chat_id,t.message_thread_id"+
  " FROM announcement_posts a"+
  " JOIN posting_deliveries d ON d.source_type='announcement'"+
  " AND d.source_id=a.announcement_id::text AND d.owner_user_id=a.owner_user_id"+
  " AND d.status='sent' AND d.telegram_message_id IS NOT NULL"+
  " JOIN posting_topics t ON t.topic_id=d.posting_topic_id"+
  " WHERE a.announcement_id=$1 AND a.owner_user_id=$2 AND a.kind='recruitment' AND a.room_id IS NULL"+
  " AND a.status='published' ORDER BY d.delivery_id DESC LIMIT 1",[sourceId,owner]);
 if(r.rows.length!==1)throw Error("RECRUITMENT_PUBLICATION_NOT_FOUND");
 const x=r.rows[0];
 const input=recruitmentInputFromRow(x);
 const snapshot=input.mode==="linked"?(x.conditions?.recruitmentUiVersion===RECRUITMENT_UI_VERSION?
  recruitmentIdentitySnapshot(x.profile_snapshot):legacyRecruitmentIdentity(input,x.profile_snapshot,String(x.rendered_text??""))):null;
 const result={sourceId,sourceRevision:Number(x.revision),
  topicId:Number(x.posting_topic_id),chatId:Number(x.chat_id),
  threadId:Number(x.message_thread_id),messageId:Number(x.telegram_message_id),input,snapshot};
 if(!validId(result.topicId)||!validId(result.messageId)||!validId(result.sourceRevision))
  throw Error("RECRUITMENT_RECEIPT_INVALID");
 return result;
}
export async function applyPublishedRecruitmentEdit(
 telegram:Telegram,owner:number,sourceId:number,expectedRevision:number,
 input:RecruitmentInput,
):Promise<PublishedRecruitment>{
 const publication=await loadPublishedRecruitment(owner,sourceId);
 if(publication.sourceRevision!==expectedRevision)throw Error("RECRUITMENT_PUBLICATION_STALE");
 const profile=input.mode==="linked"?await getProfile(owner):null;
 validateRecruitmentReady(input,profile);
 if(input.mode!==publication.input.mode)throw Error("RECRUITMENT_MODE_CHANGED");
 await assertFeatureReleased("announcement");
 const verified=await getVerifiedTopic(publication.topicId,"announcement");
 if(verified.chatId!==publication.chatId||verified.threadId!==publication.threadId)
  throw Error("RECRUITMENT_TOPIC_CHANGED");
 const rendered=renderRecruitmentCard(input,profile);
 const snapshot=profile?recruitmentIdentitySnapshot(profile):null;
 const username=await verifiedRecruitmentUsername(telegram,owner);
 const claim=await pool.query(
  "UPDATE announcement_posts SET status='publishing',updated_at=NOW()"+
  " WHERE announcement_id=$1 AND owner_user_id=$2 AND kind='recruitment' AND room_id IS NULL"+
  " AND status='published' AND revision=$3 RETURNING announcement_id",
  [sourceId,owner,expectedRevision]);
 if(claim.rows.length!==1)throw Error("RECRUITMENT_EDIT_CONFLICT");
 try{
  const receipt=await pool.query(
   "SELECT delivery_id,inline_buttons,rendered_text FROM posting_deliveries"+
   " WHERE source_type='announcement' AND source_id=$1 AND owner_user_id=$2"+
   " AND status='sent' AND telegram_message_id=$3 AND posting_topic_id=$4"+
   " ORDER BY delivery_id DESC LIMIT 1",
   [String(sourceId),owner,publication.messageId,publication.topicId]);
  if(receipt.rows.length!==1)throw Error("RECRUITMENT_DELIVERY_STALE");
  const token=await ensureRecruitmentViewToken(owner,sourceId);
  const buttons=recruitmentViewRows(token,username);
  // Compare the whole presentation, not just text; a media-only edit must
  // still advance the publication snapshot used by the panel.
  if(receipt.rows[0].rendered_text!==rendered||
     JSON.stringify(receipt.rows[0].inline_buttons??[])!==JSON.stringify(buttons)){
   await createTelegramDispatcher(telegram).revise(
    {chatId:publication.chatId,threadId:publication.threadId},
    publication.messageId,{text:rendered,parseMode:"HTML",buttons});
  }
  const conditions={
   inputMode:input.mode,title:input.title,...recruitmentExtras(input),viewToken:token,recruitmentUiVersion:RECRUITMENT_UI_VERSION,
   likeTags:validLikeTags(input.likeTags??[]),loveTags:validLikeTags(input.loveTags??[]),
   ...(input.mode==="manual"?{nickname:input.nickname,heightCm:input.heightCm,
    weightKg:input.weightKg,age:input.age,position:input.position}:{})
  };
  const cx=await pool.connect();
  try{
   await cx.query("BEGIN");
   const done=await cx.query(
    "UPDATE announcement_posts SET text=$4,conditions=conditions||$5::jsonb,profile_snapshot=$8::jsonb,"+
    " purpose_codes=$6,place_codes=$7,revision=revision+1,status='published',updated_at=NOW()"+
    " WHERE announcement_id=$1 AND owner_user_id=$2 AND revision=$3"+
    " AND status='publishing' RETURNING revision",
    [sourceId,owner,expectedRevision,input.body,JSON.stringify(conditions),
     input.purposeCodes,input.placeCodes,JSON.stringify(snapshot)]);
   if(done.rows.length!==1)throw Error("RECRUITMENT_EDIT_SYNC_CONFLICT");
   const delivery=await cx.query(
    "UPDATE posting_deliveries SET rendered_text=$4,inline_buttons=$5::jsonb,updated_at=NOW()"+
    " WHERE source_type='announcement' AND source_id=$1 AND owner_user_id=$2"+
    " AND telegram_message_id=$3 AND status='sent' AND delivery_id=$6 RETURNING delivery_id",
    [String(sourceId),owner,publication.messageId,rendered,JSON.stringify(buttons),receipt.rows[0].delivery_id]);
   if(delivery.rows.length!==1)throw Error("RECRUITMENT_DELIVERY_STALE");
   await cx.query("COMMIT");
  }catch(e){await cx.query("ROLLBACK");throw e;}finally{cx.release();}
  return {...publication,sourceRevision:expectedRevision+1,input,snapshot};
 }catch(e){
  await pool.query(
   "UPDATE announcement_posts SET status='sync_error',updated_at=NOW()"+
   " WHERE announcement_id=$1 AND owner_user_id=$2 AND status='publishing'",
   [sourceId,owner]).catch(()=>{});
  throw e;
 }
}

/** Owner-scoped removal of an already published recruitment. Keep a durable
 * receipt and fail closed on ambiguous Telegram outcomes; never re-post. */
export async function deletePublishedRecruitment(
 telegram:Telegram,owner:number,sourceId:number,
):Promise<void>{
 const post=await loadPublishedRecruitment(owner,sourceId);
 const verified=await getVerifiedTopic(post.topicId,"announcement");
 if(verified.chatId!==post.chatId||verified.threadId!==post.threadId)
  throw Error("RECRUITMENT_TOPIC_CHANGED");
 const claim=await pool.query(
  "UPDATE announcement_posts SET status='publishing',updated_at=NOW()"+
  " WHERE announcement_id=$1 AND owner_user_id=$2 AND kind='recruitment' AND room_id IS NULL"+
  " AND status='published' RETURNING announcement_id",[sourceId,owner]);
 if(claim.rows.length!==1)throw Error("RECRUITMENT_DELETE_CONFLICT");
 try{
  await createTelegramDispatcher(telegram).cancel(
   {chatId:post.chatId,threadId:post.threadId},post.messageId);
  const cx=await pool.connect();
  try{
   await cx.query("BEGIN");
   const updated=await cx.query(
    "UPDATE announcement_posts SET status='cancelled',accept_applications=FALSE,"+
    " updated_at=NOW() WHERE announcement_id=$1 AND owner_user_id=$2"+
    " AND status='publishing' RETURNING announcement_id",[sourceId,owner]);
   if(updated.rows.length!==1)throw Error("RECRUITMENT_DELETE_SYNC_CONFLICT");
   await cx.query(
    "UPDATE posting_deliveries SET status='deleted',updated_at=NOW()"+
    " WHERE source_type='announcement' AND source_id=$1 AND owner_user_id=$2"+
    " AND telegram_message_id=$3 AND status='sent'",
    [String(sourceId),owner,post.messageId]);
   await cx.query("COMMIT");
  }catch(e){await cx.query("ROLLBACK");throw e;}finally{cx.release();}
 }catch(e){
  await pool.query(
   "UPDATE announcement_posts SET status='sync_error',updated_at=NOW()"+
   " WHERE announcement_id=$1 AND owner_user_id=$2 AND status='publishing'",
   [sourceId,owner]).catch(()=>{});
  throw e;
 }
}

/** Keep the Bot DM message ID after the temporary wizard draft is finalized.
 * The public delivery and the private management screen have different IDs.
 */
export async function rememberPublishedRecruitmentDmScreen(
 owner:number,sourceId:number,dmMessageId:number,
):Promise<void>{
 if(!validId(owner)||!validId(sourceId)||!validId(dmMessageId))
  throw Error("RECRUITMENT_DM_RECEIPT_INVALID");
 const q=await pool.query(
  "UPDATE announcement_posts SET conditions=jsonb_set(conditions,"+
  " '{dmScreenMessageId}',to_jsonb($3::bigint),true),updated_at=NOW()"+
  " WHERE announcement_id=$1 AND owner_user_id=$2 AND kind='recruitment' AND room_id IS NULL"+
  " AND status IN ('published','publishing') RETURNING announcement_id",
  [sourceId,owner,dmMessageId]);
 if(q.rows.length!==1)throw Error("RECRUITMENT_DM_RECEIPT_NOT_FOUND");
}
