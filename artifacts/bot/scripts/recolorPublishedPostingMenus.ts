/** Recolor and correct ALL already-published posting entrances in place.
 * No new Telegram messages, no new topics, and no replacement of working Room UI.
 * Existing posted message IDs must be present and verified before editing.
 */
import "dotenv/config";
import https from "node:https";
import {Telegraf} from "telegraf";
import {readConfiguredBotToken} from "../src/config/botToken.js";
import {pool,closePool} from "../src/db/index.js";
import {refreshPublishedTopicDmEntry} from "../src/services/topicDmEntry.js";
import {publishExistingMenuPanel} from "../src/services/menuPanelPublisher.js";
import {BOARD_GROUP_CHAT_IDS} from "../src/services/topicRouting.js";

const CHATS=new Set<number>(Object.values(BOARD_GROUP_CHAT_IDS));
type Pin={chat_id:string;message_thread_id:string;message_id:string;verified_by:string};
type Panel={chat_id:string;message_thread_id:string;message_id:string;verified_by:string};
async function main(){
 if(process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")throw Error("PUBLIC_MENUS_NOT_RELEASED");
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL_REQUIRED");
 const apply=process.argv.length===3&&process.argv[2]==="--apply";
 if(process.argv.length>3||(process.argv.length===3&&!apply))throw Error("USAGE_DRY_RUN_OR_APPLY");
 const pins=await pool.query<Pin>(`
  SELECT chat_id,message_thread_id,message_id,verified_by
  FROM topic_dm_entry_pins
  WHERE state='published' AND pinned=TRUE AND message_id IS NOT NULL
  ORDER BY chat_id,message_thread_id`);
 const panels=await pool.query<Panel>(`
  SELECT chat_id,message_thread_id,message_id,verified_by
  FROM board_menu_panels
  WHERE panel_type='posting' AND state='published' AND pinned=TRUE
    AND message_id IS NOT NULL AND verified_at IS NOT NULL
  ORDER BY chat_id,message_thread_id`);
 const validate=(a:Pin|Panel)=>{
  const chat=Number(a.chat_id),thread=Number(a.message_thread_id);
  if(!CHATS.has(chat)||!Number.isSafeInteger(thread)||thread<=0||
     !Number.isSafeInteger(Number(a.message_id))||Number(a.message_id)<=0)
   throw Error("PIN_INVENTORY_INVALID");
 };
 for(const x of [...pins.rows,...panels.rows])validate(x);
 console.log("POSTING_MENU_INVENTORY "+JSON.stringify({
  existingTopicPins:pins.rows.length,existingPostingPanels:panels.rows.length,apply,
 }));
 if(!apply)return;
 if(!pins.rows.length&&!panels.rows.length)throw Error("NO_EXISTING_POSTING_MENU_MESSAGES");
 const bot=new Telegraf(readConfiguredBotToken(),{telegram:{agent:new https.Agent({keepAlive:true,family:4})}});
 const identity=await bot.telegram.getMe();
 if(identity.username?.toLowerCase()!=="gaybbs_bot")throw Error("WRONG_BOT_IDENTITY");
 let changed=0,failed=0;
 for(const pin of pins.rows){
  const chat=Number(pin.chat_id),thread=Number(pin.message_thread_id);
  try{
   const result=await refreshPublishedTopicDmEntry(bot.telegram,chat,thread);
   if(result.messageId!==Number(pin.message_id)||!result.updatedExisting)throw Error("PIN_CHANGED");
   console.log("TOPIC_MENU_EDITED "+chat+":"+thread);
   changed++;
  }catch(error){
   failed++;
   console.error("TOPIC_MENU_EDIT_FAILED "+chat+":"+thread+" "+
    (error instanceof Error?error.message:"UNKNOWN"));
  }
  await new Promise(resolve=>setTimeout(resolve,160));
 }
 for(const panel of panels.rows){
  const chat=Number(panel.chat_id),thread=Number(panel.message_thread_id);
  try{
   const result=await publishExistingMenuPanel(
    bot.telegram,chat,thread,Number(panel.verified_by));
   if(result.messageId!==Number(panel.message_id)||!result.updatedExisting)throw Error("PANEL_REPLACED");
   console.log("POSTING_PANEL_EDITED "+chat+":"+thread);
   changed++;
  }catch(error){
   failed++;
   console.error("POSTING_PANEL_EDIT_FAILED "+chat+":"+thread+" "+
    (error instanceof Error?error.message:"UNKNOWN"));
  }
  await new Promise(resolve=>setTimeout(resolve,160));
 }
 console.log("POSTING_MENU_EDIT_SUMMARY "+
  JSON.stringify({existing:pins.rows.length+panels.rows.length,changed,failed,newMessages:0}));
 if(failed)process.exitCode=1;
}
main().catch(error=>{
 console.error("POSTING_MENU_EDIT_PREFLIGHT_FAILED",
  error instanceof Error?error.message:"UNKNOWN");
 process.exitCode=1;
}).finally(async()=>{await closePool();});
