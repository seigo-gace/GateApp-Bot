/** Existing-profile-card keyboard refresh; only edits reply_markup on the
 * existing Telegram message ID. No deleteMessage/sendMessage/republication.
 */
import "dotenv/config";
import https from "node:https";
import {Telegraf} from "telegraf";
import {readConfiguredBotToken} from "../src/config/botToken.js";
import {runMigrations} from "../src/db/migrate.js";
import {closePool} from "../src/db/index.js";
import {applyProfileKeyboardBackfill} from "../src/services/profileKeyboardBackfill.js";

async function main(){
 const mode=process.argv[2];
 if(mode!=="--dry-run"&&mode!=="--apply")throw Error("PROFILE_BACKFILL_MODE_REQUIRED");
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL_REQUIRED");
 const bot=new Telegraf(readConfiguredBotToken(),{telegram:{agent:new https.Agent({keepAlive:true,family:4})}});
 try{
  const me=await bot.telegram.getMe();
  if(me.username?.toLowerCase()!=="gaybbs_bot"||me.id===8086265383)
   throw Error("GAYBBS_BOT_IDENTITY_MISMATCH");
  if(mode==="--apply")await runMigrations();
  const stats=await applyProfileKeyboardBackfill(bot.telegram,{dryRun:mode==="--dry-run",limit:100});
  console.log(JSON.stringify({mode,existing_posts:stats.selected,applied:stats.applied,
   skipped:stats.skipped,uncertain:stats.uncertain}));
  if(stats.uncertain)process.exitCode=2;
 }finally{
  await closePool();
 }
}
main().catch(e=>{console.error("PROFILE_BACKFILL_FAILED:",String(e?.message||"UNKNOWN"));process.exitCode=1;});
