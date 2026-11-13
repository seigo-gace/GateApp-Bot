/** One-shot recovery of only the 15 verified but unpublished Topic DM entries.
 * Safe boundary: never edit/reissue an already published pinned entry.
 * This is an operator tool, NOT a bot handler and NOT a command menu.
 */
import "dotenv/config";
import https from "node:https";
import { Telegraf } from "telegraf";
import { readConfiguredBotToken } from "../src/config/botToken.js";
import { pool,closePool } from "../src/db/index.js";
import { publishTopicDmEntry } from "../src/services/topicDmEntry.js";

const TARGETS:ReadonlyArray<readonly [number,number]>=[
 [-1003847210571,501],[-1003847210571,1118],
 [-1003847210571,1119],[-1003847210571,1120],
 [-1003847210571,1123],[-1003847210571,1166],
 [-1003847210571,1613],
 [-1002373696859,4531],[-1002373696859,4532],
 [-1002373696859,4533],[-1002373696859,4565],
 [-1003770334893,1028],[-1003770334893,1029],
 [-1003770334893,1030],[-1003770334893,1058],
];
type EntryRow={
 title:string; verified_by:string; state:string;
 pinned:boolean; message_id:string|null;
};
async function main():Promise<void>{
 if(process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")
  throw Error("PUBLIC_MENUS_NOT_RELEASED");
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL_REQUIRED");
 if(TARGETS.length!==15||new Set(TARGETS.map(x=>x.join(":"))).size!==15)
  throw Error("TARGET_ALLOWLIST_INVALID");
 const token=readConfiguredBotToken();
 const bot=new Telegraf(token,{telegram:{
  agent:new https.Agent({keepAlive:true,family:4}),
 }});
 const me=await bot.telegram.getMe();
 if(me.username?.toLowerCase()!=="gaybbs_bot")
  throw Error("BOT_IDENTITY_INVALID");
 // Preflight every fixed destination before any Telegram mutation.
 const rows:EntryRow[]=[];
 for(const [chatId,threadId] of TARGETS){
  const q=await pool.query<EntryRow>(
   `SELECT title,verified_by,state,pinned,message_id
    FROM topic_dm_entry_pins
    WHERE chat_id=$1 AND message_thread_id=$2`,[chatId,threadId]);
  if(q.rows.length!==1)throw Error("TARGET_PIN_ROW_MISSING:"+threadId);
  const row=q.rows[0]!;
  if(row.state==="published"&&row.pinned===true&&row.message_id!==null){
   rows.push(row);continue;
  }
  if(row.state!=="verified"||row.pinned!==false||row.message_id!==null||
     !row.title?.trim()||Number(row.verified_by)<=0)
   throw Error("TARGET_NOT_SAFE_TO_PUBLISH:"+threadId);
  rows.push(row);
 }
 let published=0,already=0,failed=0;
 for(let i=0;i<TARGETS.length;i++){
  const [chatId,threadId]=TARGETS[i]!;
  const row=rows[i]!;
  if(row.state==="published"){already++;continue;}
  try{
   const result=await publishTopicDmEntry(
    bot.telegram,chatId,threadId,row.title,Number(row.verified_by));
   const check=await pool.query(
    `SELECT 1 FROM topic_dm_entry_pins
     WHERE chat_id=$1 AND message_thread_id=$2
       AND state='published' AND pinned=TRUE
       AND message_id=$3 AND token_hash IS NOT NULL`,
    [chatId,threadId,result.messageId]);
   if(check.rowCount!==1)throw Error("PUBLISH_READBACK_FAILED");
   published++;
   console.log("ENTRY_PIN_PUBLISHED "+chatId+":"+threadId);
  }catch(err){
   failed++;
   console.error("ENTRY_PIN_FAILED "+chatId+":"+threadId+" "+
    (err instanceof Error?err.message:"UNKNOWN"));
  }
 }
 console.log("ENTRY_PIN_SUMMARY "+
  JSON.stringify({expected:15,published,already,failed}));
 if(failed)process.exitCode=1;
}
main().catch(e=>{
 console.error("ENTRY_PIN_PREFLIGHT_FAILED",e instanceof Error?e.message:"UNKNOWN");
 process.exitCode=1;
}).finally(async()=>{await closePool();});
