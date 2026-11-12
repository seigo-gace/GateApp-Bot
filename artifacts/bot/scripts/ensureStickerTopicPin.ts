/**
 * One-shot owner operation, not another bot/poller.
 * Runs with the EXISTING GayBBS group Bot API only. The target username
 * is the Master-approved public @CreateVdobot deep link, NOT a fabricated
 * getMe verification of a second Bot.
 * Existing verified topic row is mandatory; never infer a thread from a URL.
 *
 * Inputs: DATABASE_URL, BOT_TOKEN or BOT_TOKEN_FILE (existing GayBBS).
 * No CreateVdobot token, polling, or Userbot session access.
 * No token or request URL is printed.
 */
import "dotenv/config";
import {readConfiguredBotToken} from "../src/config/botToken.js";
import {createStickerTopicOwnerPort} from "../src/services/stickerTopicOwnerPort.js";
import {pool,closePool} from "../src/db/index.js";

const api=(token:string)=>async(method:string,params:Record<string,unknown>):Promise<unknown>=>{
 const result=await fetch("https://api.telegram.org/bot"+token+"/"+method,{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify(params),signal:AbortSignal.timeout(15000)
 });
 const json=await result.json() as {ok?:boolean;result?:unknown};
 if(!result.ok||json?.ok!==true||json.result===undefined)
   throw new Error("STICKER_PIN_TELEGRAM_"+method+"_FAILED");
 return json.result;
};
async function inspectReadOnly():Promise<void>{
 const q=await pool.query(
  "SELECT to_regclass('public.posting_topics') IS NOT NULL AS topics,"+
  " to_regclass('public.posting_sticker_entry_pins') IS NOT NULL AS pins"
 );
 const topics=q.rows[0]?.topics===true;
 const pins=q.rows[0]?.pins===true;
 console.log("STICKER_PIN_DB_TOPIC_TABLE="+(topics?"PRESENT":"MISSING"));
 console.log("STICKER_PIN_DB_RECEIPT_TABLE="+(pins?"PRESENT":"MISSING"));
 if(!topics)return;
 // Read-only inventory of topic identities already registered by the owner.
 // No Telegram API side effects and no inferred message_thread_id.
 const summary=await pool.query(
  "SELECT COUNT(*)::integer AS total,"+
  " COUNT(*) FILTER (WHERE verified_at IS NOT NULL AND verified_by IS NOT NULL)::integer AS verified,"+
  " COUNT(*) FILTER (WHERE title ILIKE '%ステッカー%' OR title ILIKE '%sticker%')::integer AS sticker_titles"+
  " FROM posting_topics WHERE chat_id=$1",
  [-1002373696859]
 );
 console.log("STICKER_PIN_REGISTERED_GROUP_TOPICS="+Number(summary.rows[0]?.total??0));
 console.log("STICKER_PIN_REGISTERED_VERIFIED_TOPICS="+Number(summary.rows[0]?.verified??0));
 console.log("STICKER_PIN_REGISTERED_STICKER_TITLES="+Number(summary.rows[0]?.sticker_titles??0));
 const candidates=await pool.query(
  "SELECT title,purpose,message_thread_id,enabled,"+
  " (verified_at IS NOT NULL AND verified_by IS NOT NULL) AS verified"+
  " FROM posting_topics WHERE chat_id=$1"+
  " AND (title ILIKE '%ステッカー%' OR title ILIKE '%sticker%')"+
  " ORDER BY topic_id LIMIT 10",[-1002373696859]
 );
 for(const row of candidates.rows){
  const title=String(row.title??"").slice(0,80).replace(/[\\r\\n]/g," ");
  console.log("STICKER_PIN_CANDIDATE="+JSON.stringify({
   title,purpose:row.purpose,thread_id:Number(row.message_thread_id),
   enabled:row.enabled===true,verified:row.verified===true
  }));
 }
 const t=await pool.query(
  "SELECT COUNT(*)::integer AS total,"+
  " COUNT(*) FILTER (WHERE purpose='sticker')::integer AS sticker_purpose,"+
  " COUNT(*) FILTER (WHERE purpose='sticker' AND verified_at IS NOT NULL"+
  " AND verified_by IS NOT NULL)::integer AS verified"+
  " FROM posting_topics WHERE board_key='video_chat' AND enabled=TRUE"+
  " AND title=$1 AND chat_id=$2",
  ["ステッカーの公開と販売",-1002373696859]
 );
 const row=t.rows[0];
 console.log("STICKER_PIN_TOPIC_MATCHES="+Number(row?.total??0));
 console.log("STICKER_PIN_TOPIC_STICKER_PURPOSE="+Number(row?.sticker_purpose??0));
 console.log("STICKER_PIN_TOPIC_VERIFIED="+Number(row?.verified??0));
 if(pins){
  const p=await pool.query(
   "SELECT status,COUNT(*)::integer AS total FROM posting_sticker_entry_pins"+
   " WHERE topic_id IN (SELECT topic_id FROM posting_topics WHERE"+
   " board_key='video_chat' AND title=$1 AND chat_id=$2) GROUP BY status",
   ["ステッカーの公開と販売",-1002373696859]
  );
  for(const receipt of p.rows)
   if(["sending","sent","pin_requested","pinned_ack","needs_reconcile"].includes(receipt.status))
    console.log("STICKER_PIN_RECEIPT_"+receipt.status.toUpperCase()+"="+Number(receipt.total));
 }
}
async function main():Promise<void>{
 if(typeof process.env.DATABASE_URL!=="string"||!process.env.DATABASE_URL)
   throw Error("STICKER_PIN_DATABASE_NOT_CONFIGURED");
 if(process.env.STICKER_PIN_MODE==="inspect")return inspectReadOnly();
 const postingBotApi=api(readConfiguredBotToken());
 const owner=await postingBotApi("getMe",{}) as {id?:number;username?:string;is_bot?:boolean};
 if(owner.is_bot!==true||owner.username?.toLowerCase()!=="gaybbs_bot"||
    !Number.isSafeInteger(owner.id)||Number(owner.id)<=0)
   throw Error("STICKER_PIN_GROUP_BOT_NOT_VERIFIED");
 const service=createStickerTopicOwnerPort({
   creatorBotUsername:"CreateVdobot",postingBotApi});
 const result=await service.ensureStickerEntryPin();
 console.log("STICKER_PIN_OWNER=GAYBBS");
 console.log("STICKER_PIN_TARGET=CREATEVDOBOT");
 console.log("STICKER_PIN_TARGET_SOURCE=MASTER_FIXED_USERNAME");
 console.log("STICKER_PIN_TELEGRAM_ACK="+(result.acknowledged?"YES":"NO"));
 console.log("STICKER_PIN_MESSAGE_ID="+String(result.messageId??0));
 console.log("STICKER_PIN_INDEPENDENT_READBACK="+(result.readbackVerified?"PASS":"NOT_VERIFIED"));
}
try{await main();}
catch(e){
 // Never print sensitive external error objects or token-bearing URLs.
 const msg=e instanceof Error?e.message:"UNKNOWN";
 console.error("STICKER_PIN_RESULT=FAIL");
 console.error("STICKER_PIN_ERROR="+
  (/^(STICKER_|TOPIC_)/.test(msg)?msg:
   /relation .*posting_sticker_entry_pins.* does not exist/.test(msg)?"STICKER_PIN_RECEIPT_SCHEMA_MISSING":
   /relation .*posting_topics.* does not exist/.test(msg)?"STICKER_PIN_TOPIC_SCHEMA_MISSING":
   /column .* does not exist/.test(msg)?"STICKER_PIN_DB_SCHEMA_STALE":
   /BOT_TOKEN/.test(msg)?"STICKER_PIN_GROUP_TOKEN_READER_ERROR":
   /authentication failed/.test(msg)?"STICKER_PIN_DATABASE_AUTH_FAILED":
   /ENOTFOUND|ECONNREFUSED/.test(msg)?"STICKER_PIN_DATABASE_NETWORK_FAILED":
   "UNCLASSIFIED_FAILURE"));
 process.exitCode=1;
}finally{await closePool();}
