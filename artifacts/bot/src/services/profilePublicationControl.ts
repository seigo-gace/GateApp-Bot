/** Owner-approved profile unpublish/delete. A Telegram timeout leaves an
 * actionable 'delete_error' rather than declaring completion or re-sending.
 */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {createTelegramDispatcher} from "./telegramDispatcher.js";
import {listProfilePublications} from "./profileRepository.js";

function assertOwner(id:number){if(!Number.isSafeInteger(id)||id<=0)throw Error("PROFILE_OWNER_INVALID");}
export async function hidePublishedProfile(
 telegram:Telegram,ownerId:number,chatId:number,threadId:number,
 mode:"unpublish"|"delete",
):Promise<{state:"hidden";messageId:number}>{
 assertOwner(ownerId);
 if(!Number.isSafeInteger(chatId)||chatId>=0||
    !Number.isSafeInteger(threadId)||threadId<=0)
  throw Error("PROFILE_DESTINATION_INVALID");
 const rows=await listProfilePublications(ownerId);
 const found=rows.find(x=>x.chatId===chatId&&x.threadId===threadId);
 if(!found||found.status!=="published"||found.messageId<=0)
  throw Error("PROFILE_PUBLICATION_UNAVAILABLE_OR_NEEDS_RECONCILE");
 const claimed=await pool.query(
  `UPDATE profile_publications
   SET status='delete_error',last_error='PUBLICATION_REMOVAL_OUTCOME_UNKNOWN',updated_at=NOW()
   WHERE owner_user_id=$1 AND chat_id=$2 AND thread_id=$3 AND status='published'
   AND message_id=$4 RETURNING message_id`,
  [ownerId,chatId,threadId,found.messageId]);
 if(claimed.rows.length!==1)throw Error("PROFILE_PUBLICATION_REMOVAL_STALE");
 const target={chatId,threadId};
 try{
  if(mode==="delete"){
   await createTelegramDispatcher(telegram).cancel(target,found.messageId);
  }else{
   // Hide without requiring Telegram's age-limited message deletion.
   await createTelegramDispatcher(telegram).revise(target,found.messageId,
    {text:"このプロフィールは非公開になりました。"});
  }
 }catch{
  // Unknown: Telegram may already have removed the original message.
  throw Error("PROFILE_PUBLICATION_REMOVAL_NEEDS_RECONCILE");
 }
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const done=await c.query(
   `UPDATE profile_publications SET status='hidden',last_error=NULL,
      updated_at=NOW() WHERE owner_user_id=$1 AND chat_id=$2 AND thread_id=$3
      AND status='delete_error' AND message_id=$4 RETURNING message_id`,
   [ownerId,chatId,threadId,found.messageId]);
  if(done.rows.length!==1)throw Error("PROFILE_PUBLICATION_REMOVAL_STALE");
  await c.query(
   `UPDATE profiles SET status='private',updated_at=NOW()
    WHERE owner_user_id=$1 AND NOT EXISTS(
      SELECT 1 FROM profile_publications WHERE owner_user_id=$1
        AND status IN ('published','sync_error','delete_error')
    )`,[ownerId]);
  await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 return {state:"hidden",messageId:found.messageId};
}
