/** Update only reply_markup on existing, verified GayBBS public messages.
 * No sendMessage/deleteMessage. Ambiguous attempts never auto retry.
 * Existing Room lifecycle posts are deliberately NOT overwritten from stale
 * delivery JSON: Room's live transition uses the shared startless transport.
 */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {BOARD_GROUP_CHAT_IDS} from "./topicRouting.js";
import {buildLinks,type PanelRow} from "./menuPanelPublisher.js";
import {renderMenuPanel,type ButtonSpec} from "./menuPanelRenderer.js";
import {publicNavigationButton} from "./startlessNavigation.js";
import {refreshPublishedTopicDmEntry} from "./topicDmEntry.js";
import {boardPanel} from "../bot/topicBoardHandlers.js";
import {commitGeneralGuideDmTokens,rollbackGeneralGuideDmTokens} from "./generalGuideDmLinks.js";

type Kind="menu"|"topic"|"board";
export type StartlessExistingRow={kind:Kind;identity:string;chatId:number;threadId:number;messageId:number};
export type StartlessMigrationResult={selected:number;applied:number;skipped:number;uncertain:number};
function approvedChat(chat:number){
 if(!Object.values(BOARD_GROUP_CHAT_IDS).includes(chat))throw Error("STARTLESS_GROUP_NOT_REGISTERED");
}
function keyboard(rows:readonly (readonly ButtonSpec[])[]){
 return {inline_keyboard:rows.map(row=>row.map(raw=>{
  const b=publicNavigationButton(raw);
  return {text:b.text,...(b.copy_text?{copy_text:b.copy_text}:
    b.callback_data?{callback_data:b.callback_data}:{url:b.url}),
    ...(b.style?{style:b.style}:{})};
 }))} as Parameters<Telegram["editMessageReplyMarkup"]>[3];
}
async function targets():Promise<StartlessExistingRow[]>{
 const [menus,topics,boards]=await Promise.all([
  pool.query("SELECT panel_id::text AS identity,chat_id,message_thread_id,message_id FROM board_menu_panels WHERE state='published' AND pinned=TRUE AND message_id>0 ORDER BY chat_id,message_id"),
  pool.query("SELECT (chat_id::text||':'||message_thread_id::text) AS identity,chat_id,message_thread_id,message_id FROM topic_dm_entry_pins WHERE state='published' AND pinned=TRUE AND message_id>0 ORDER BY chat_id,message_id"),
  pool.query("SELECT board_key AS identity,chat_id,message_thread_id,message_id FROM topic_board_posts WHERE state='published' AND message_id>0 ORDER BY chat_id,message_id"),
 ]);
 const result:StartlessExistingRow[]=[];
 for(const [kind,rows] of [["menu",menus.rows],["topic",topics.rows],["board",boards.rows]] as const){
  for(const r of rows){
   const target={kind,identity:String(r.identity),chatId:Number(r.chat_id),
    threadId:Number(r.message_thread_id),messageId:Number(r.message_id)};
   approvedChat(target.chatId);
   if(!Number.isSafeInteger(target.threadId)||target.threadId<=0||
      !Number.isSafeInteger(target.messageId)||target.messageId<=0)
    throw Error("STARTLESS_PUBLIC_POST_ID_INVALID");
   result.push(target);
  }
 }
 const keys=new Set<string>();
 for(const r of result){
  const key=r.chatId+":"+r.messageId;
  if(keys.has(key))throw Error("STARTLESS_POST_DUPLICATE_OWNERSHIP:"+key);
  keys.add(key);
 }
 return result;
}
export async function dryRunStartlessExistingPosts():Promise<StartlessMigrationResult>{
 const list=await targets();
 return {selected:list.length,applied:0,skipped:0,uncertain:0};
}
async function verifySamePost(row:StartlessExistingRow){
 const relation=row.kind==="menu"?"board_menu_panels":
  row.kind==="topic"?"topic_dm_entry_pins":"topic_board_posts";
 const key=row.kind==="menu"?"panel_id::text=$4":
  row.kind==="topic"?"(chat_id::text||':'||message_thread_id::text)=$4":"board_key=$4";
 const check=await pool.query(
  "SELECT 1 FROM "+relation+" WHERE chat_id=$1 AND message_thread_id=$2 AND message_id=$3 AND "+
   key+" AND state='published'",[row.chatId,row.threadId,row.messageId,row.identity]);
 if(check.rows.length!==1)throw Error("STARTLESS_PUBLISHED_POST_CHANGED");
}
async function applyOne(telegram:Telegram,row:StartlessExistingRow){
 await verifySamePost(row);
 if(row.kind==="topic"){
  const out=await refreshPublishedTopicDmEntry(telegram,row.chatId,row.threadId);
  if(!out.updatedExisting||out.messageId!==row.messageId)throw Error("STARTLESS_TOPIC_ID_CHANGED");
 }else if(row.kind==="menu"){
  const db=await pool.query(
   "SELECT * FROM board_menu_panels WHERE panel_id::text=$1 AND state='published' AND message_id=$2",
   [row.identity,row.messageId]);
  if(db.rows.length!==1)throw Error("STARTLESS_MENU_NOT_VERIFIED");
  const panel=db.rows[0] as PanelRow;
  const mint=await buildLinks(panel);
  const board=Object.entries(BOARD_GROUP_CHAT_IDS).find(([,chat])=>chat===row.chatId)?.[0];
  if(!board)throw Error("STARTLESS_BOARD_UNKNOWN");
  const rendered=renderMenuPanel({type:panel.panel_type,
   board:board as "area_bbs"|"video_chat"|"gay_board",
   links:mint.links,entryLinks:mint.entries});
  await telegram.editMessageReplyMarkup(row.chatId,row.messageId,undefined,keyboard(rendered.rows));
  if(mint.tokenHashes.length){
   await pool.query(
    "UPDATE board_menu_entry_tokens SET enabled=FALSE WHERE panel_id=$1 AND enabled=TRUE AND NOT(token_hash=ANY($2::text[]))",
    [row.identity,mint.tokenHashes]);
  }
 }else{
  const built=await boardPanel(row.identity);
  try{
   await telegram.editMessageReplyMarkup(row.chatId,row.messageId,undefined,keyboard(built.panel.rows));
   if(built.guideDm)await commitGeneralGuideDmTokens(built.guideDm.panelId,built.guideDm.tokenHashes);
  }catch(e){
   if(built.guideDm)await rollbackGeneralGuideDmTokens(built.guideDm.panelId,built.guideDm.tokenHashes);
   throw e;
  }
 }
 await verifySamePost(row);
}
export async function applyStartlessExistingPosts(telegram:Telegram):Promise<StartlessMigrationResult>{
 const list=await targets();
 const stats:StartlessMigrationResult={selected:list.length,applied:0,skipped:0,uncertain:0};
 for(const row of list){
  const claim=await pool.query(
   "INSERT INTO startless_public_post_migrations(kind,identity,chat_id,message_id,state) "+
   "VALUES($1,$2,$3,$4,'attempted') ON CONFLICT DO NOTHING RETURNING state",
   [row.kind,row.identity,row.chatId,row.messageId]);
  if(!claim.rows.length){stats.skipped++;continue;}
  try{
   await applyOne(telegram,row);
   await pool.query(
    "UPDATE startless_public_post_migrations SET state='applied',updated_at=NOW() "+
    "WHERE kind=$1 AND identity=$2 AND chat_id=$3 AND message_id=$4 AND state='attempted'",
    [row.kind,row.identity,row.chatId,row.messageId]);
   stats.applied++;
  }catch{
   await pool.query(
    "UPDATE startless_public_post_migrations SET state='uncertain',updated_at=NOW() "+
    "WHERE kind=$1 AND identity=$2 AND chat_id=$3 AND message_id=$4 AND state='attempted'",
    [row.kind,row.identity,row.chatId,row.messageId]);
   stats.uncertain++;
  }
 }
 return stats;
}
