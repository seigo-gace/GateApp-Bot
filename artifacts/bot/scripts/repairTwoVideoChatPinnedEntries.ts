/** One-shot: repair the two Master-selected video-chat Topic DM doorways only.
 * Dry-run by default. No broad Topic publish, no deletion, no Userbot session.
 * Existing pinned entries are edited; uncertain sends are never duplicated.
 */
import "dotenv/config";
import https from "node:https";
import {Telegraf} from "telegraf";
import {readConfiguredBotToken} from "../src/config/botToken.js";
import {pool,closePool} from "../src/db/index.js";
import {BOARD_GROUP_CHAT_IDS} from "../src/services/topicRouting.js";
import {
 assertPostingDoorwayAllowed,permittedTopicDmEntry,
 publishTopicDmEntry,refreshPublishedTopicDmEntry,
 recoverExistingTopicDmEntry,canReuseUncertainEntry,
} from "../src/services/topicDmEntry.js";

type Candidate={chat_id:string|number;message_thread_id:string|number;title:string;verified_by:string|number};
type Pin={state:string|null;pinned:boolean|null;message_id:string|null;token_hash:string|null};
type Target={chatId:number;threadId:number;title:string;adminId:number;pin:Pin|null};

function validInt(x:unknown):number{
 const n=Number(x);
 if(!Number.isSafeInteger(n)||n<=0)throw Error("INVALID_INTEGER");
 return n;
}
async function verifiedCandidates(chatId:number):Promise<Candidate[]>{
 const q=await pool.query<Candidate>(`
  SELECT DISTINCT ON (chat_id,message_thread_id)
   chat_id,message_thread_id,title,verified_by
  FROM posting_topics
  WHERE chat_id=$1 AND enabled=TRUE AND verified_at IS NOT NULL
    AND title ~ 'ビデオ.?チャット'
  ORDER BY chat_id,message_thread_id,verified_at DESC
 `,[chatId]);
 return q.rows;
}
async function findTargets():Promise<Target[]>{
 const out:Target[]=[];
 for(const [board,chatId] of [
  ["video_chat",BOARD_GROUP_CHAT_IDS.video_chat],
  ["gay_board",BOARD_GROUP_CHAT_IDS.gay_board],
 ] as const){
  const candidates=await verifiedCandidates(chatId);
  const selected=board==="video_chat"
   ? candidates.filter(r=>Number(r.message_thread_id)===1695)
   : candidates.filter(r=>/ビデオ.?チャット.*専用|専用.*ビデオ.?チャット/u.test(r.title));
  if(selected.length!==1)throw Error("TARGET_NOT_UNIQUE:"+board+":"+selected.length);
  const r=selected[0]!;
  const threadId=validInt(r.message_thread_id),adminId=validInt(r.verified_by);
  if(!permittedTopicDmEntry(chatId,threadId))throw Error("TARGET_FORBIDDEN:"+board);
  if(!/ビデオ.?チャット/u.test(r.title))throw Error("TARGET_TITLE_INVALID:"+board);
  await assertPostingDoorwayAllowed(chatId,threadId,r.title);
  const p=await pool.query<Pin>(
   `SELECT state,pinned,message_id,token_hash FROM topic_dm_entry_pins
     WHERE chat_id=$1 AND message_thread_id=$2`,[chatId,threadId]);
  if(p.rows.length>1)throw Error("PIN_DUPLICATED:"+board);
  const pin=p.rows[0]??null;
  const known=pin&&canReuseUncertainEntry(String(pin.state),pin.message_id);
  const published=pin?.state==="published"&&pin.pinned===true&&validInt(pin.message_id);
  if(pin&&!known&&!published&&!(pin.state==="verified"&&pin.message_id===null))
   throw Error("PIN_RECONCILE_REQUIRED:"+board);
  out.push({chatId,threadId,title:r.title,adminId,pin});
 }
 if(out.length!==2||out[0]!.chatId===out[1]!.chatId)
  throw Error("EXACT_TWO_GROUPS_REQUIRED");
 return out;
}
async function main():Promise<void>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL_REQUIRED");
 const apply=process.env.VIDEO_TWO_TOPIC_ENTRY_APPLY==="enabled";
 if(apply&&process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")
  throw Error("PUBLIC_MENUS_NOT_RELEASED");
 const targets=await findTargets(); // Validate BOTH before any mutation.
 const bot=new Telegraf(readConfiguredBotToken(),{
  telegram:{agent:new https.Agent({keepAlive:true,family:4})}
 });
 const me=await bot.telegram.getMe();
 if(me.username?.toLowerCase()!=="gaybbs_bot")throw Error("BOT_IDENTITY_INVALID");
 for(const [i,t] of targets.entries()){
  const admin=await bot.telegram.getChatMember(t.chatId,t.adminId);
  const member=await bot.telegram.getChatMember(t.chatId,me.id);
  if(admin.status!=="creator"&&admin.status!=="administrator")
   throw Error("OPERATOR_NOT_ADMIN:"+i);
  if(member.status!=="creator"&&
     (member.status!=="administrator"||!member.can_pin_messages))
   throw Error("PIN_PERMISSION_MISSING:"+i);
 }
 console.log("VIDEO_ENTRY_PREFLIGHT",JSON.stringify({
  targets:targets.map(t=>({chatId:t.chatId,threadId:t.threadId,
   pinState:t.pin?.state??"absent",hasMessage:!!t.pin?.message_id})),
  mode:apply?"APPLY":"DRY_RUN",
 }));
 if(!apply)return;
 for(const [i,t] of targets.entries()){
  const p=t.pin;
  const result=p?.state==="published"&&p.pinned===true&&p.message_id
   ? await refreshPublishedTopicDmEntry(bot.telegram,t.chatId,t.threadId)
   : p&&canReuseUncertainEntry(String(p.state),p.message_id)
    ? await recoverExistingTopicDmEntry(bot.telegram,t.chatId,t.threadId,t.adminId)
    : await publishTopicDmEntry(bot.telegram,t.chatId,t.threadId,t.title,t.adminId);
  const q=await pool.query(
   `SELECT message_id FROM topic_dm_entry_pins WHERE chat_id=$1
     AND message_thread_id=$2 AND state='published' AND pinned=TRUE
     AND message_id=$3 AND token_hash IS NOT NULL`,
   [t.chatId,t.threadId,result.messageId]);
  if(q.rowCount!==1)throw Error("POST_AND_PIN_READBACK_FAILED:"+i);
  console.log("VIDEO_ENTRY_FIXED",JSON.stringify({index:i,
   threadId:t.threadId,messageId:result.messageId,
   editedExisting:result.updatedExisting}));
 }
}
main().catch(e=>{
 const reason=e instanceof Error?e.message:"UNKNOWN";
 console.error("VIDEO_ENTRY_FAILED",reason);
 if(reason.startsWith("TARGET_NOT_UNIQUE:video_chat"))process.exitCode=51;
 else if(reason.startsWith("TARGET_NOT_UNIQUE:gay_board"))process.exitCode=52;
 else if(reason.startsWith("TARGET_FORBIDDEN"))process.exitCode=53;
 else if(reason.startsWith("TARGET_TITLE_INVALID"))process.exitCode=54;
 else if(reason==="TOPIC_ENTRY_EXCLUDED_BY_MASTER")process.exitCode=55;
 else if(reason.startsWith("PIN_RECONCILE_REQUIRED"))process.exitCode=56;
 else if(reason.startsWith("PIN_PERMISSION_MISSING"))process.exitCode=57;
 else if(reason.startsWith("OPERATOR_NOT_ADMIN"))process.exitCode=58;
 else if(reason==="DATABASE_URL_REQUIRED")process.exitCode=59;
 else process.exitCode=1;
}).finally(async()=>{await closePool();});
