/** Existing-profile-card keyboard refresh; only edits reply_markup on the
 * existing Telegram message ID. No deleteMessage/sendMessage/republication.
 */
import "dotenv/config";
import {readFileSync,lstatSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {Telegraf} from "telegraf";
import {runMigrations} from "../src/db/migrate.js";
import {closePool} from "../src/db/index.js";
import {applyProfileKeyboardBackfill} from "../src/services/profileKeyboardBackfill.js";

function token():string{
 const path=process.env.GAYBBS_TOKEN_FILE||join(homedir(),".config","gace","tgtumbler","gaybbs-bot.env");
 const info=lstatSync(path);
 if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o777)!==0o600||
    info.uid!==process.getuid?.())throw Error("GAYBBS_SECRET_FILE_UNSAFE");
 const lines=readFileSync(path,"utf8").split(/\r?\n/).filter(s=>s.startsWith("BOT_TOKEN="));
 if(lines.length!==1||!/^BOT_TOKEN=[0-9]+:[A-Za-z0-9_-]+$/.test(lines[0]!))
  throw Error("GAYBBS_SECRET_INVALID");
 return lines[0]!.slice(10);
}
async function main(){
 const mode=process.argv[2];
 if(mode!=="--dry-run"&&mode!=="--apply")throw Error("PROFILE_BACKFILL_MODE_REQUIRED");
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL_REQUIRED");
 const bot=new Telegraf(token());
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
