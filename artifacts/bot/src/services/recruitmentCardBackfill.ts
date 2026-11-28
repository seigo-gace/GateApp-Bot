/** Switch existing recruitment messages in place. Only stored public data
 * and sent receipts are used; never read a private profile or create posts. */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {assertFeatureReleased} from "./publishService.js";
import {getVerifiedTopic} from "./postingDelivery.js";
import {createTelegramDispatcher} from "./telegramDispatcher.js";
import {renderRecruitmentCard} from "./recruitmentCompose.js";
import {ensureRecruitmentViewToken,legacyRecruitmentIdentity,recruitmentInputFromRow,recruitmentViewRows,
 verifiedRecruitmentUsername,RECRUITMENT_UI_VERSION} from "./recruitmentPublicView.js";
import type {ProfileBasicDraft} from "./profileCore.js";

export type RecruitmentBackfillResult={
 publishedSources:number;sentReceipts:number;alreadyCurrent:number;
 eligibleSources:number;eligibleReceipts:number;updatedSources:number;updatedReceipts:number;
 unresolved:number;uncertain:number;nonPublishedUnresolved:number;
};
/** Enumerate all source rows, not a fixed first page. Dry-run validates the
 * actual stored sent text and IDs; no writes or Telegram side effects. */
export async function backfillRecruitmentCards(telegram:Telegram,dryRun=true):Promise<RecruitmentBackfillResult>{
 const q=await pool.query(
  "SELECT announcement_id,owner_user_id,revision,text,conditions,profile_snapshot,purpose_codes,place_codes,status"+
  " FROM announcement_posts WHERE kind='recruitment' AND room_id IS NULL AND status IN ('published','publishing','sync_error') ORDER BY announcement_id");
 const stats:RecruitmentBackfillResult={publishedSources:0,sentReceipts:0,alreadyCurrent:0,
  eligibleSources:0,eligibleReceipts:0,updatedSources:0,updatedReceipts:0,
  unresolved:0,uncertain:0,nonPublishedUnresolved:0};
 if(!dryRun)await assertFeatureReleased("announcement");
 for(const row of q.rows){
  const sourceId=Number(row.announcement_id),owner=Number(row.owner_user_id),revision=Number(row.revision);
  if(row.status!=="published"){stats.nonPublishedUnresolved++;continue;}
  stats.publishedSources++;
  const deliveries=await pool.query(
   "SELECT d.delivery_id,d.posting_topic_id,d.telegram_message_id,d.rendered_text,d.inline_buttons,t.chat_id,t.message_thread_id"+
   " FROM posting_deliveries d JOIN posting_topics t ON t.topic_id=d.posting_topic_id"+
   " WHERE d.source_type='announcement' AND d.source_id=$1 AND d.owner_user_id=$2"+
   " AND d.status='sent' AND d.telegram_message_id IS NOT NULL ORDER BY d.delivery_id",[String(sourceId),owner]);
  stats.sentReceipts+=deliveries.rows.length;
  let input:ReturnType<typeof recruitmentInputFromRow>,basic:ProfileBasicDraft,card:string;
  try{
   if(!deliveries.rows.length)throw Error("RECRUITMENT_DELIVERY_MISSING");
   input=recruitmentInputFromRow(row);
   const identities:ProfileBasicDraft[]=[];
   for(const delivery of deliveries.rows){
    const topic=await getVerifiedTopic(Number(delivery.posting_topic_id),"announcement");
    if(topic.chatId!==Number(delivery.chat_id)||topic.threadId!==Number(delivery.message_thread_id)||
      !Number.isSafeInteger(Number(delivery.telegram_message_id))||Number(delivery.telegram_message_id)<=0)
     throw Error("RECRUITMENT_DELIVERY_INVALID");
    identities.push(legacyRecruitmentIdentity(input,row.profile_snapshot,String(delivery.rendered_text??"")));
   }
   basic=identities[0]!;
   if(identities.some(v=>JSON.stringify(v)!==JSON.stringify(basic)))throw Error("RECRUITMENT_LEGACY_IDENTITY_CONFLICT");
   card=renderRecruitmentCard(input,basic);
   if(row.conditions?.recruitmentUiVersion===RECRUITMENT_UI_VERSION){
    const token=row.conditions.viewToken;
    if(typeof token!=="string"||deliveries.rows.some(d=>d.rendered_text!==card||
     JSON.stringify(d.inline_buttons??[]).indexOf("rv:show:"+token+":profile")===-1))
     throw Error("RECRUITMENT_CURRENT_RECEIPT_MISMATCH");
    stats.alreadyCurrent+=deliveries.rows.length;continue;
   }
  }catch{stats.unresolved++;continue;}
  stats.eligibleSources++;stats.eligibleReceipts+=deliveries.rows.length;
  if(dryRun)continue;
  let claimed=false,attempted=false;
  try{
   const username=await verifiedRecruitmentUsername(telegram,owner);
   const claim=await pool.query(
    "UPDATE announcement_posts SET status='publishing',updated_at=NOW() WHERE announcement_id=$1 AND owner_user_id=$2"+
    " AND revision=$3 AND status='published' AND kind='recruitment' AND room_id IS NULL AND conditions->>'recruitmentUiVersion' IS DISTINCT FROM $4"+
    " RETURNING announcement_id",[sourceId,owner,revision,String(RECRUITMENT_UI_VERSION)]);
   if(claim.rows.length!==1){stats.unresolved++;continue;}
   claimed=true;
   const token=await ensureRecruitmentViewToken(owner,sourceId),buttons=recruitmentViewRows(token,username);
   for(const delivery of deliveries.rows){
    attempted=true;
    await createTelegramDispatcher(telegram).revise(
     {chatId:Number(delivery.chat_id),threadId:Number(delivery.message_thread_id)},
     Number(delivery.telegram_message_id),{text:card,parseMode:"HTML",buttons});
    const receipt=await pool.query(
     "UPDATE posting_deliveries SET rendered_text=$2,inline_buttons=$3::jsonb,updated_at=NOW()"+
     " WHERE delivery_id=$1 AND status='sent' AND telegram_message_id=$4 AND owner_user_id=$5"+
     " RETURNING delivery_id",[delivery.delivery_id,card,JSON.stringify(buttons),delivery.telegram_message_id,owner]);
    if(receipt.rows.length!==1)throw Error("RECRUITMENT_BACKFILL_RECEIPT_CONFLICT");
    stats.updatedReceipts++;
   }
   const final=await pool.query(
    "UPDATE announcement_posts SET status='published',profile_snapshot=$4::jsonb,"+
    " conditions=conditions||$5::jsonb,updated_at=NOW() WHERE announcement_id=$1 AND owner_user_id=$2"+
    " AND revision=$3 AND status='publishing' AND kind='recruitment' AND room_id IS NULL RETURNING announcement_id",
    [sourceId,owner,revision,JSON.stringify(input.mode==="linked"?basic:null),
     JSON.stringify({viewToken:token,recruitmentUiVersion:RECRUITMENT_UI_VERSION})]);
   if(final.rows.length!==1)throw Error("RECRUITMENT_BACKFILL_SOURCE_CONFLICT");
   stats.updatedSources++;
  }catch{
   if(claimed)await pool.query(
    "UPDATE announcement_posts SET status=$4,updated_at=NOW() WHERE announcement_id=$1 AND owner_user_id=$2"+
    " AND revision=$3 AND status='publishing'",[sourceId,owner,revision,attempted?"sync_error":"published"]).catch(()=>undefined);
   if(attempted)stats.uncertain++;else stats.unresolved++;
  }
 }
 return stats;
}
