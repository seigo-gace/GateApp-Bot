/** Existing-topic M1/M2 publication gate. Never send unless explicitly enabled
 * and the verified source documents / entrypoints are complete.
 * Every ambiguous send/edit/pin result is persisted for manual reconciliation.
 */
import type { Telegram } from "telegraf";
import { createTelegramDispatcher } from "./telegramDispatcher.js";
import { pool } from "../db/index.js";
import {commonGateUrl} from "./commonGateInvite.js";
import {POSTING_EDITOR_SPECS,POSTING_PUBLIC_NAV_LABELS,POSTING_FEATURES,POSTING_CREATOR_URL,POSTING_TALK_URL,POSTING_BUG_REPORT_URL,loadPostingFeatureReadiness} from "./postingMenuRoutes.js";
import {newMenuToken,tokenHash} from "./menuOrigin.js";
import {loadGeneralGuideNavLinks} from "./generalGuideNavLinks.js";
import {renderMenuPanel,type ButtonSpec,type EntryLink,type NavLink} from "./menuPanelRenderer.js";

/** Panel menus must be URL inline_keyboard only — never URL body lists. */
function assertInlineKeyboard(rows:readonly (readonly ButtonSpec[])[]):void{
 if(!rows.length)throw new Error("INLINE_KEYBOARD_EMPTY");
 for(const row of rows){
  if(!row.length)throw new Error("INLINE_KEYBOARD_EMPTY_ROW");
  for(const cell of row){
   if(!cell.text?.trim()||!cell.url?.trim())throw new Error("INLINE_KEYBOARD_EMPTY_CELL");
  }
 }
 if(rows.flat().some(b=>b.url.includes("\n")))throw new Error("INLINE_KEYBOARD_URL_BODY_FORBIDDEN");
}
import {BOARD_GROUP_CHAT_IDS,type BoardKey} from "./topicRouting.js";
export type PanelRow={
 panel_id:string;chat_id:string;message_thread_id:string;panel_type:"general_guide"|"posting";
 state:string;message_id:string|null;pinned:boolean;
};
function board(chatId:number):BoardKey{
 const found=Object.entries(BOARD_GROUP_CHAT_IDS)
  .find(([,id])=>id===chatId)?.[0] as BoardKey|undefined;
 if(!found)throw new Error("UNREGISTERED_GROUP");
 return found;
}
export async function buildLinks(panel:PanelRow):Promise<{
 links:NavLink[];entries:EntryLink[];tokenHashes:string[];
}>{
 const chatId=Number(panel.chat_id);
 if(panel.panel_type==="general_guide"){
  const links=await loadGeneralGuideNavLinks(chatId);
  return {links,entries:[],tokenHashes:[]};
 }
 // These three destinations already have one adopted Owner/route each.
 // Per-group legacy link rows must not change common menu functionality.
 const gateUrl=await commonGateUrl();
 const links:NavLink[]=POSTING_PUBLIC_NAV_LABELS.map(label=>{
  if(label==="クリエーター有料ビデオ投稿")
   return {label:"クリエーター投稿",url:POSTING_CREATOR_URL,verified:true};
  if(label==="雑談")
   return {label:"雑談",url:POSTING_TALK_URL,verified:true};
  return {label:"紹介/招待",url:gateUrl,copy_text:{text:gateUrl},verified:true};
 });
 const ready=await loadPostingFeatureReadiness();
 if(!POSTING_FEATURES.every(x=>ready.has(x)))
  throw new Error("POSTING_DM_FEATURES_NOT_RELEASED");
 links.push({label:"🐞 不具合を報告",url:POSTING_BUG_REPORT_URL,verified:true});
 const entries:EntryLink[]=[];
 const tokenHashes:string[]=[];
 for(const entry of POSTING_EDITOR_SPECS){
  const token=newMenuToken();
  const hash=tokenHash(token);
  tokenHashes.push(hash);
  entries.push({feature:entry.feature,label:entry.label,
   url:entry.feature==="link"?"https://t.me/GayBBS_bot?start=link":
    "https://t.me/GayBBS_bot?start="+entry.prefix+token,ready:true});
 }
 await pool.query(
  `INSERT INTO board_menu_entry_tokens(token_hash,panel_id,feature,expires_at,enabled)
   SELECT token_hash,$1,feature,NOW()+INTERVAL '365 days',TRUE
   FROM UNNEST($2::text[],$3::text[]) AS candidate(token_hash,feature)`,
  [panel.panel_id,tokenHashes,POSTING_EDITOR_SPECS.map(x=>x.feature)]);
 return {links,entries,tokenHashes};
}
async function markUnknown(id:string,messageId:number|null):Promise<void>{
 await pool.query(
  `UPDATE board_menu_panels SET state='needs_reconcile',
   message_id=COALESCE($2,message_id),updated_at=NOW()
   WHERE panel_id=$1 AND state='publishing'`,[id,messageId]);
}
export async function publishExistingMenuPanel(
 telegram:Telegram,chatId:number,threadId:number,adminId:number
):Promise<{messageId:number;updatedExisting:boolean}>{
 if(process.env.GAYBBS_PUBLIC_MENU_RELEASE!=="enabled")
  throw new Error("PUBLIC_MENUS_NOT_RELEASED");
 const membership=await telegram.getChatMember(chatId,adminId);
 if(membership.status!=="administrator"&&membership.status!=="creator")
  throw new Error("PANEL_OPERATOR_NOT_ADMIN");
 const self=await telegram.getMe();
 const myMembership=await telegram.getChatMember(chatId,self.id);
 if(myMembership.status!=="administrator"&&myMembership.status!=="creator")
  throw new Error("PANEL_BOT_NOT_ADMIN");
 const claim=await pool.query(
  `UPDATE board_menu_panels SET state='publishing',updated_at=NOW()
   WHERE chat_id=$1 AND message_thread_id=$2 AND state IN ('verified','published')
   RETURNING *`,[chatId,threadId]);
 if(claim.rows.length!==1)throw new Error("PANEL_NOT_VERIFIED_OR_RECONCILE_REQUIRED");
 const panel=claim.rows[0] as PanelRow;
 let messageId=panel.message_id?Number(panel.message_id):null;
 const updating=messageId!==null;
 let deliveryAttempted=false;
 let tokenHashes:string[]=[];
 try{
  const resolved=await buildLinks(panel);
  const {links,entries}=resolved;
  tokenHashes=resolved.tokenHashes;
  const rendered=renderMenuPanel({
   type:panel.panel_type,board:board(chatId),links,entryLinks:entries,
  });
  assertInlineKeyboard(rendered.rows);
  const dispatcher=createTelegramDispatcher(telegram);
  const target={chatId,threadId};
  const body={text:rendered.text,parseMode:"HTML" as const,buttons:rendered.rows};
  if(messageId!==null){
   deliveryAttempted=true;
   await dispatcher.revise(target,messageId,body);
  }else{
   deliveryAttempted=true;
   messageId=await dispatcher.publish(target,body);
   await pool.query(
    "UPDATE board_menu_panels SET message_id=$2,updated_at=NOW() WHERE panel_id=$1 AND state='publishing'",
    [panel.panel_id,messageId]);
  }
  if(!panel.pinned)await telegram.pinChatMessage(chatId,messageId,{disable_notification:true});
  const cx=await pool.connect();
  try{
   await cx.query("BEGIN");
   const commit=await cx.query(
    `UPDATE board_menu_panels SET state='published',message_id=$2,pinned=TRUE,
     revision=revision+1,updated_at=NOW() WHERE panel_id=$1 AND state='publishing'
     RETURNING panel_id`,[panel.panel_id,messageId]);
   if(commit.rows.length!==1)throw new Error("PANEL_ACK_CONFLICT");
   if(panel.panel_type==="posting"&&tokenHashes.length){
    await cx.query(
     `UPDATE board_menu_entry_tokens SET enabled=FALSE
      WHERE panel_id=$1 AND enabled=TRUE AND NOT(token_hash=ANY($2::text[]))`,
     [panel.panel_id,tokenHashes]);
   }
   await cx.query("COMMIT");
  }catch(error){
   await cx.query("ROLLBACK");throw error;
  }finally{cx.release();}
  return {messageId,updatedExisting:updating};
 }catch(e){
  if(deliveryAttempted){
   await markUnknown(panel.panel_id,messageId);
  }else{
   if(tokenHashes.length)await pool.query(
    "UPDATE board_menu_entry_tokens SET enabled=FALSE WHERE panel_id=$1 AND token_hash=ANY($2::text[])",
    [panel.panel_id,tokenHashes]);
   await pool.query(
    `UPDATE board_menu_panels SET state=$2,updated_at=NOW()
      WHERE panel_id=$1 AND state='publishing'`,
    [panel.panel_id,updating?"published":"verified"]);
  }
  throw e;
 }
}
