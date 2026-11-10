import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {getProfile} from "./profileRepository.js";
import {renderRecruitmentPreview,validateRecruitmentReady,type RecruitmentInput} from "./recruitmentCompose.js";
import {getVerifiedTopic} from "./postingDelivery.js";
import {assertFeatureReleased} from "./publishService.js";
import {createTelegramDispatcher} from "./telegramDispatcher.js";

export type PublishedRecruitment={
 sourceId:number;sourceRevision:number;
 topicId:number;chatId:number;threadId:number;messageId:number;
 input:RecruitmentInput;
};
const validId=(v:number)=>Number.isSafeInteger(v)&&v>0;
export async function loadPublishedRecruitment(owner:number,sourceId:number):Promise<PublishedRecruitment>{
 if(!validId(owner)||!validId(sourceId))throw Error("RECRUITMENT_PUBLICATION_INVALID");
 const r=await pool.query(
  "SELECT a.announcement_id,a.revision,a.text,a.conditions,a.purpose_codes,a.place_codes,"+
  " d.telegram_message_id,d.posting_topic_id,t.chat_id,t.message_thread_id"+
  " FROM announcement_posts a"+
  " JOIN posting_deliveries d ON d.source_type='announcement'"+
  " AND d.source_id=a.announcement_id::text AND d.owner_user_id=a.owner_user_id"+
  " AND d.status='sent' AND d.telegram_message_id IS NOT NULL"+
  " JOIN posting_topics t ON t.topic_id=d.posting_topic_id"+
  " WHERE a.announcement_id=$1 AND a.owner_user_id=$2 AND a.kind='recruitment'"+
  " AND a.status='published' ORDER BY d.delivery_id DESC LIMIT 1",[sourceId,owner]);
 if(r.rows.length!==1)throw Error("RECRUITMENT_PUBLICATION_NOT_FOUND");
 const x=r.rows[0],c=x.conditions??{},linked=c.inputMode==="linked";
 if(linked&&!(await getProfile(owner)))throw Error("RECRUITMENT_LINKED_PROFILE_MISSING");
 const input:RecruitmentInput={
  mode:linked?"linked":"manual",title:String(c.title??""),body:String(x.text??""),
  ...(linked?{}:{nickname:String(c.nickname??""),heightCm:Number(c.heightCm),
   weightKg:Number(c.weightKg),age:Number(c.age),position:String(c.position??"")}),
  purposeCodes:Array.isArray(x.purpose_codes)?x.purpose_codes:[],
  placeCodes:Array.isArray(x.place_codes)?x.place_codes:[],
 };
 const result={sourceId,sourceRevision:Number(x.revision),
  topicId:Number(x.posting_topic_id),chatId:Number(x.chat_id),
  threadId:Number(x.message_thread_id),messageId:Number(x.telegram_message_id),input};
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
 const rendered=renderRecruitmentPreview(input,profile);
 const claim=await pool.query(
  "UPDATE announcement_posts SET status='publishing',updated_at=NOW()"+
  " WHERE announcement_id=$1 AND owner_user_id=$2 AND kind='recruitment'"+
  " AND status='published' AND revision=$3 RETURNING announcement_id",
  [sourceId,owner,expectedRevision]);
 if(claim.rows.length!==1)throw Error("RECRUITMENT_EDIT_CONFLICT");
 try{
  const receipt=await pool.query(
   "SELECT inline_buttons FROM posting_deliveries"+
   " WHERE source_type='announcement' AND source_id=$1 AND owner_user_id=$2"+
   " AND status='sent' AND telegram_message_id=$3 AND posting_topic_id=$4"+
   " ORDER BY delivery_id DESC LIMIT 1",
   [String(sourceId),owner,publication.messageId,publication.topicId]);
  if(receipt.rows.length!==1)throw Error("RECRUITMENT_DELIVERY_STALE");
  await createTelegramDispatcher(telegram).revise(
   {chatId:publication.chatId,threadId:publication.threadId},
   publication.messageId,{text:rendered,parseMode:"HTML",
    buttons:receipt.rows[0].inline_buttons??[]});
  const conditions={
   inputMode:input.mode,title:input.title,
   ...(input.mode==="manual"?{nickname:input.nickname,heightCm:input.heightCm,
    weightKg:input.weightKg,age:input.age,position:input.position}:{})
  };
  const cx=await pool.connect();
  try{
   await cx.query("BEGIN");
   const done=await cx.query(
    "UPDATE announcement_posts SET text=$4,conditions=$5::jsonb,"+
    " purpose_codes=$6,place_codes=$7,revision=revision+1,status='published',updated_at=NOW()"+
    " WHERE announcement_id=$1 AND owner_user_id=$2 AND revision=$3"+
    " AND status='publishing' RETURNING revision",
    [sourceId,owner,expectedRevision,input.body,JSON.stringify(conditions),
     input.purposeCodes,input.placeCodes]);
   if(done.rows.length!==1)throw Error("RECRUITMENT_EDIT_SYNC_CONFLICT");
   await cx.query(
    "UPDATE posting_deliveries SET rendered_text=$4,updated_at=NOW()"+
    " WHERE source_type='announcement' AND source_id=$1 AND owner_user_id=$2"+
    " AND telegram_message_id=$3 AND status='sent'",
    [String(sourceId),owner,publication.messageId,rendered]);
   await cx.query("COMMIT");
  }catch(e){await cx.query("ROLLBACK");throw e;}finally{cx.release();}
  return {...publication,sourceRevision:expectedRevision+1,input};
 }catch(e){
  await pool.query(
   "UPDATE announcement_posts SET status='sync_error',updated_at=NOW()"+
   " WHERE announcement_id=$1 AND owner_user_id=$2 AND status='publishing'",
   [sourceId,owner]).catch(()=>{});
  throw e;
 }
}
