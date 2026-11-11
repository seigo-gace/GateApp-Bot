/** Existing L2 area Topic coverage repair; no new Topic creation.
 * Canonical labels and URL suffixes are ONLY candidates. Their real Telegram
 * thread IDs are confirmed with a throwaway send+delete before DB registration.
 * Disabled/unverified pre-existing records are never silently re-enabled.
 */
import "dotenv/config";
import https from "node:https";
import {Telegraf} from "telegraf";
import {readConfiguredBotToken} from "../src/config/botToken.js";
import {pool,closePool} from "../src/db/index.js";
import {AREA_BLOCKS,AREA_CHAT_ID} from "../src/services/topicBoardContent.js";
import {publishTopicDmEntry} from "../src/services/topicDmEntry.js";

export type AreaDestination={block:string;title:string;candidateThread:number};
export function intendedAreaDestinations():AreaDestination[]{
 const items=AREA_BLOCKS.flatMap(block=>block.children.map(child=>{
  if(!child.url)throw Error("AREA_LINK_NOT_REGISTERED:"+block.label+"/"+child.label);
  const match=/^https:\/\/t\.me\/c\/3847210571\/([1-9][0-9]*)$/.exec(child.url);
  if(!match)throw Error("AREA_LINK_OUTSIDE_ALLOWED_GROUP");
  const candidateThread=Number(match[1]);
  if(!Number.isSafeInteger(candidateThread))throw Error("AREA_THREAD_CANDIDATE_INVALID");
  return {block:block.label,title:child.label,candidateThread};
 }));
 if(items.length!==56||new Set(items.map(x=>x.candidateThread)).size!==56)
  throw Error("AREA_L2_CANONICAL_COVERAGE_INVALID");
 return items;
}

async function main(){
 const expected=intendedAreaDestinations();
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL_REQUIRED");
 const apply=process.env.AREA_ENTRY_REPAIR_APPLY==="enabled";
 if(apply&&process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")
  throw Error("PUBLIC_MENUS_NOT_RELEASED");
 const limit=Number(process.env.AREA_ENTRY_REPAIR_LIMIT??"5");
 if(!Number.isSafeInteger(limit)||limit<1||limit>10)
  throw Error("AREA_REPAIR_LIMIT_INVALID");
 const bot=new Telegraf(readConfiguredBotToken(),{
  telegram:{agent:new https.Agent({keepAlive:true,family:4})}
 });
 const me=await bot.telegram.getMe();
 if(me.username!=="GayBBS_bot")throw Error("BOT_IDENTITY_UNEXPECTED");
 if(apply){
  const member=await bot.telegram.getChatMember(AREA_CHAT_ID,me.id);
  if(member.status!=="creator"&&
     (member.status!=="administrator"||!member.can_pin_messages))
   throw Error("BOT_AREA_PIN_PERMISSION_REQUIRED");
 }
 const counters={expected:expected.length,verified:0,pinned:0,missing:0,
  repaired:0,skippedProtected:0,pendingPin:0,failed:0};
 let remaining=limit;
 for(const t of expected){
  const existing=await pool.query(
   `SELECT enabled,verified_at,verified_by FROM posting_topics
    WHERE board_key='area_bbs' AND purpose='announcement'
      AND chat_id=$1 AND message_thread_id=$2`,
   [AREA_CHAT_ID,t.candidateThread]);
  if(existing.rows.length>1)throw Error("AREA_ROUTE_AMBIGUOUS");
  const row=existing.rows[0];
  const valid=!!row&&row.enabled===true&&!!row.verified_at&&row.verified_by!=null;
  if(valid)counters.verified++;
  if(row&&!valid){counters.skippedProtected++;continue;}
  const pin=await pool.query(
   `SELECT state,pinned,message_id FROM topic_dm_entry_pins
    WHERE chat_id=$1 AND message_thread_id=$2`,
   [AREA_CHAT_ID,t.candidateThread]);
  if(pin.rows.length>1)throw Error("AREA_PIN_AMBIGUOUS");
  const priorPin=pin.rows[0];
  const published=priorPin?.state==="published"&&priorPin.pinned===true&&
   Number(priorPin.message_id)>0;
  if(published)counters.pinned++;
  if(priorPin&&!published&&priorPin.state!=="verified"){
   counters.skippedProtected++;continue;
  }
  if(valid&&published)continue;
  counters.missing++;
  if(!apply||remaining<=0)continue;
  remaining--;
  try{
   if(!valid){
    // Candidate IDs obtained from navigation links are NOT presumed to be
    // forum thread IDs until Telegram confirms the response correlation.
    const probe=await bot.telegram.sendMessage(AREA_CHAT_ID,
     "🔎 投稿先の接続確認（Bot自動検証）",{
      message_thread_id:t.candidateThread,disable_notification:true
     });
    let removed=false;
    try{
     if(probe.message_thread_id!==t.candidateThread)
      throw Error("AREA_THREAD_PROBE_MISMATCH");
    }finally{
     removed=await bot.telegram.deleteMessage(AREA_CHAT_ID,probe.message_id)
      .catch(()=>false);
    }
    if(!removed)throw Error("AREA_THREAD_PROBE_DELETE_FAILED");
    const inserted=await pool.query(
     `INSERT INTO posting_topics
       (board_key,purpose,chat_id,message_thread_id,title,
        verified_by,verified_at,enabled)
      VALUES ('area_bbs','announcement',$1,$2,$3,$4,NOW(),TRUE)
      ON CONFLICT (board_key,purpose,chat_id,message_thread_id) DO NOTHING
      RETURNING topic_id`,
     [AREA_CHAT_ID,t.candidateThread,t.title,me.id]);
    if(inserted.rows.length!==1)throw Error("AREA_ROUTE_CONCURRENT_CHANGE");
   }
   // Reuse the already deployed shared pinned DM doorway exactly as-is.
   if(!published)await publishTopicDmEntry(
    bot.telegram,AREA_CHAT_ID,t.candidateThread,t.title,me.id);
   const readback=await pool.query(
    `SELECT p.topic_id,t.message_id FROM posting_topics p
      JOIN topic_dm_entry_pins t ON
       p.chat_id=t.chat_id AND p.message_thread_id=t.message_thread_id
      WHERE p.board_key='area_bbs' AND p.purpose='announcement'
       AND p.chat_id=$1 AND p.message_thread_id=$2
       AND p.enabled=TRUE AND p.verified_at IS NOT NULL
       AND t.state='published' AND t.pinned=TRUE AND t.message_id IS NOT NULL`,
    [AREA_CHAT_ID,t.candidateThread]);
   if(readback.rows.length!==1)throw Error("AREA_ENTRY_READBACK_FAILED");
   counters.repaired++;
  }catch(e){
   counters.failed++;
   console.error("AREA_ENTRY_REPAIR_FAILURE",JSON.stringify({
    block:t.block,title:t.title,reason:e instanceof Error?e.message:"UNKNOWN"
   }));
   // Never advance to another topic after an unknown Telegram send result.
   throw e;
  }
 }
 console.log("AREA_ENTRY_COVERAGE",JSON.stringify({...counters,
  mode:apply?"APPLY":"DRY_RUN",remainingBudget:remaining}));
}
main().catch(e=>{
 console.error("AREA_ENTRY_RECONCILE_FAILED",e instanceof Error?e.message:"UNKNOWN");
 process.exitCode=1;
}).finally(async()=>{await closePool();});
