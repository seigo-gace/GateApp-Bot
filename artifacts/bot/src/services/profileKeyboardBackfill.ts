/** One-time, idempotent keyboard-only migration of already published profile cards.
 * This code NEVER sends, deletes, edits the body, or changes source publication IDs.
 * A transport ambiguity stays in 'uncertain' for manual reconciliation.
 */
import {randomBytes} from "node:crypto";
import {Markup,type Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {profilePanelRows} from "./profilePublicView.js";

type ExistingPost={
 ownerId:number;revision:number;topicId:number;chatId:number;threadId:number;
 messageId:number;username:string|null;token:string|null;
};
export type BackfillResult={selected:number;applied:number;skipped:number;uncertain:number};
export function backfillKeyboard(token:string,username:string|null){
 return Markup.inlineKeyboard(profilePanelRows(token,username).map(row=>row.map(button=>
  button.url?Markup.button.url(button.text,button.url):
   Markup.button.callback(button.text,button.callback_data!)
 ))).reply_markup;
}
function positive(n:number){return Number.isSafeInteger(n)&&n>0;}
function validatePost(p:ExistingPost):void{
 if(!positive(p.ownerId)||!positive(p.revision)||!positive(p.topicId)||
    !positive(p.threadId)||!positive(p.messageId)||
    !Number.isSafeInteger(p.chatId)||p.chatId>=0)
  throw Error("PROFILE_BACKFILL_INVALID_POST");
}
export async function listExistingProfilePosts(limit=100):Promise<ExistingPost[]>{
 if(!positive(limit)||limit>500)throw Error("PROFILE_BACKFILL_LIMIT_INVALID");
 const table=await pool.query("SELECT to_regclass('profile_keyboard_backfill') IS NOT NULL AS ready");
 const hasReceiptTable=table.rows[0]?.ready===true;
 const receiptJoin=hasReceiptTable?`LEFT JOIN profile_keyboard_backfill k
    ON k.chat_id=pub.chat_id AND k.message_id=pub.message_id
    AND k.profile_revision=pub.synced_revision`:"";
 const receiptFilter=hasReceiptTable?"AND (k.state IS NULL OR k.state='ready')":"";
 const r=await pool.query(`
  SELECT pub.owner_user_id,pub.synced_revision,pub.chat_id,pub.thread_id,
    pub.message_id,t.topic_id,p.username,l.token
  FROM profile_publications pub
  JOIN profiles p ON p.owner_user_id=pub.owner_user_id AND p.status='published'
  JOIN posting_topics t ON t.chat_id=pub.chat_id AND t.message_thread_id=pub.thread_id
    AND t.purpose='profile' AND t.enabled=TRUE
    AND t.verified_by IS NOT NULL AND t.verified_at IS NOT NULL
  LEFT JOIN profile_view_links l ON l.owner_user_id=pub.owner_user_id
    AND l.profile_revision=pub.synced_revision AND l.topic_id=t.topic_id AND l.enabled=TRUE
  ${receiptJoin}
  WHERE pub.status='published' AND pub.synced_revision>0
    AND pub.message_id>0 AND pub.public_snapshot IS NOT NULL
    ${receiptFilter}
  ORDER BY pub.chat_id,pub.message_id LIMIT $1`,[limit]);
 return r.rows.map(x=>({
  ownerId:Number(x.owner_user_id),revision:Number(x.synced_revision),
  topicId:Number(x.topic_id),chatId:Number(x.chat_id),
  threadId:Number(x.thread_id),messageId:Number(x.message_id),
  username:typeof x.username==="string"?x.username:null,
  token:typeof x.token==="string"?x.token:null,
 }));
}
async function prepareToken(p:ExistingPost):Promise<string>{
 validatePost(p);
 const candidate=randomBytes(24).toString("base64url");
 const result=await pool.query(`
  INSERT INTO profile_view_links(owner_user_id,profile_revision,topic_id,token)
  SELECT pub.owner_user_id,pub.synced_revision,$3,$4
  FROM profile_publications pub
  JOIN profiles owner ON owner.owner_user_id=pub.owner_user_id AND owner.status='published'
  JOIN posting_topics t ON t.topic_id=$3 AND t.chat_id=pub.chat_id
   AND t.message_thread_id=pub.thread_id AND t.purpose='profile'
   AND t.enabled=TRUE AND t.verified_at IS NOT NULL AND t.verified_by IS NOT NULL
  WHERE pub.owner_user_id=$1 AND pub.synced_revision=$2 AND pub.status='published'
    AND pub.chat_id=$5 AND pub.thread_id=$6 AND pub.message_id=$7
    AND pub.public_snapshot IS NOT NULL
  ON CONFLICT(owner_user_id,profile_revision,topic_id)
    DO UPDATE SET token=profile_view_links.token
  RETURNING token,enabled`,
  [p.ownerId,p.revision,p.topicId,candidate,p.chatId,p.threadId,p.messageId]);
 if(result.rows.length!==1||result.rows[0].enabled!==true)
  throw Error("PROFILE_BACKFILL_PUBLICATION_STALE");
 return String(result.rows[0].token);
}
export async function applyProfileKeyboardBackfill(
 telegram:Pick<Telegram,"editMessageReplyMarkup">,
 options:{dryRun?:boolean;limit?:number}={},
):Promise<BackfillResult>{
 const posts=await listExistingProfilePosts(options.limit??100);
 const stats:BackfillResult={selected:posts.length,applied:0,skipped:0,uncertain:0};
 if(options.dryRun)return stats; // No DB/API writes on preview.
 for(const post of posts){
  validatePost(post);
  // Token creation is not publication, and is stable on conflict.
  const token=await prepareToken(post);
  const claim=await pool.query(`
   INSERT INTO profile_keyboard_backfill(chat_id,message_id,profile_revision,
      owner_user_id,state)
   SELECT $1,$2,$3,$4,'attempted'
   WHERE EXISTS(
    SELECT 1 FROM profile_publications WHERE owner_user_id=$4
      AND chat_id=$1 AND message_id=$2 AND synced_revision=$3 AND status='published')
   ON CONFLICT(chat_id,message_id,profile_revision) DO UPDATE
      SET state='attempted',updated_at=NOW()
      WHERE profile_keyboard_backfill.state='ready'
   RETURNING state`,
   [post.chatId,post.messageId,post.revision,post.ownerId]);
  if(claim.rows.length!==1){stats.skipped++;continue;}
  try{
   const response=await telegram.editMessageReplyMarkup(
    post.chatId,post.messageId,undefined,backfillKeyboard(token,post.username));
   // Bot-originated group posts must return the original Message, not a new one.
   if(!response||typeof response!=="object"||
      !("message_id" in response)||Number(response.message_id)!==post.messageId||
      !("chat" in response)||Number((response.chat as {id?:unknown}).id)!==post.chatId)
      throw Error("PROFILE_BACKFILL_MESSAGE_RECEIPT_MISMATCH");
   const mark=await pool.query(`
    UPDATE profile_keyboard_backfill SET state='applied',updated_at=NOW()
     WHERE chat_id=$1 AND message_id=$2 AND profile_revision=$3 AND state='attempted'
     RETURNING message_id`,[post.chatId,post.messageId,post.revision]);
   if(mark.rows.length!==1)throw Error("PROFILE_BACKFILL_RECEIPT_PERSIST_FAILED");
   stats.applied++;
  }catch{
   // Network timeout / API refusal may already have modified the original.
   // Keep attempt marker, never blindly reapply or replace the source post.
   await pool.query(`
    UPDATE profile_keyboard_backfill SET state='uncertain',updated_at=NOW()
    WHERE chat_id=$1 AND message_id=$2 AND profile_revision=$3 AND state='attempted'`,
    [post.chatId,post.messageId,post.revision]);
   stats.uncertain++;
  }
 }
 return stats;
}
