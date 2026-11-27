/** Explicit one-time maintenance: update only existing published keyboards.
 * Standard mode is dry-run. --apply is never invoked by Bot startup.
 */
import "dotenv/config";
import https from "node:https";
import {Telegraf} from "telegraf";
import {readConfiguredBotToken} from "../src/config/botToken.js";
import {runMigrations} from "../src/db/migrate.js";
import {closePool} from "../src/db/index.js";
import {dryRunStartlessExistingPosts,applyStartlessExistingPosts} from "../src/services/startlessExistingPosts.js";

async function main(){
 const arg=process.argv[2];
 if(arg!=="--dry-run"&&arg!=="--apply")throw Error("STARTLESS_MIGRATION_MODE_REQUIRED");
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL_REQUIRED");
 const bot=new Telegraf(readConfiguredBotToken(),{
  telegram:{agent:new https.Agent({keepAlive:true,family:4})},
 });
 try{
  const me=await bot.telegram.getMe();
  if(me.username?.toLowerCase()!=="gaybbs_bot"||me.id===8086265383)
   throw Error("STARTLESS_BOT_IDENTITY_MISMATCH");
  if(arg==="--apply")await runMigrations();
  const result=arg==="--apply"
    ?await applyStartlessExistingPosts(bot.telegram)
    :await dryRunStartlessExistingPosts();
  console.log(JSON.stringify({mode:arg,...result}));
  if(result.uncertain)process.exitCode=2;
 }finally{await closePool();}
}
main().catch(error=>{
 console.error("STARTLESS_MIGRATION_FAILED",error instanceof Error?error.message:"unknown");
 process.exitCode=1;
});
