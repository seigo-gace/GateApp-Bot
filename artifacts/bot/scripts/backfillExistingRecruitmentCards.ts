import "dotenv/config";
import https from "node:https";
import {Telegraf} from "telegraf";
import {readConfiguredBotToken} from "../src/config/botToken.js";
import {closePool} from "../src/db/index.js";
import {backfillRecruitmentCards} from "../src/services/recruitmentCardBackfill.js";
async function main(){
 const mode=process.argv[2];
 if(mode!=="--dry-run"&&mode!=="--apply")throw Error("RECRUITMENT_BACKFILL_MODE_REQUIRED");
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL_REQUIRED");
 const bot=new Telegraf(readConfiguredBotToken(),{telegram:{agent:new https.Agent({keepAlive:true,family:4})}});
 try{
  const me=await bot.telegram.getMe();
  if(me.username?.toLowerCase()!=="gaybbs_bot"||me.id===8086265383)throw Error("GAYBBS_BOT_IDENTITY_MISMATCH");
  const stats=await backfillRecruitmentCards(bot.telegram,mode==="--dry-run");
  console.log(JSON.stringify({mode,...stats}));
  if(stats.unresolved||stats.uncertain||stats.nonPublishedUnresolved)process.exitCode=2;
 }finally{await closePool();}
}
main().catch(e=>{console.error("RECRUITMENT_BACKFILL_FAILED:",String(e?.message||"UNKNOWN"));process.exitCode=1;});
