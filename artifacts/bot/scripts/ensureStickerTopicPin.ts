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
import {closePool} from "../src/db/index.js";

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
async function main():Promise<void>{
 if(typeof process.env.DATABASE_URL!=="string"||!process.env.DATABASE_URL)
   throw Error("STICKER_PIN_DATABASE_NOT_CONFIGURED");
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
  (/^(STICKER_|TOPIC_)/.test(msg)?msg:"UNCLASSIFIED_FAILURE"));
 process.exitCode=1;
}finally{await closePool();}
