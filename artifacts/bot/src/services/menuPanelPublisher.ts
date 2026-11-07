/** Existing-topic M1/M2 publication gate. Never send unless explicitly enabled
 * and the verified source documents / entrypoints are complete.
 * Every ambiguous send/edit/pin result is persisted for manual reconciliation.
 */
import type { Telegram } from "telegraf";
import { createTelegramDispatcher } from "./telegramDispatcher.js";
import { pool } from "../db/index.js";
import {guideMessageUrl} from "../bot/generalGuideHandlers.js";
import {newMenuToken,tokenHash} from "./menuOrigin.js";
import {renderMenuPanel,type NavLink,type EntryLink} from "./menuPanelRenderer.js";
type PanelRow={
 panel_id:string;chat_id:string;message_thread_id:string;panel_type:"general_guide"|"posting";
 state:string;message_id:string|null;pinned:boolean;
};
function board(chatId:number):"area_bbs"|"video_chat"|"gay_board"{
 const found:Record<string,"area_bbs"|"video_chat"|"gay_board">={
  "-1003847210571":"area_bbs","-1002373696859":"video_chat",
  "-1003770334893":"gay_board"};
 const result=found[String(chatId)];
 if(!result)throw new Error("UNREGISTERED_GROUP");
 return result;
}
async function buildLinks(panel:PanelRow):Promise<{
 links:NavLink[];entries:EntryLink[];
}>{
 const chatId=Number(panel.chat_id);
 if(panel.panel_type==="general_guide"){
  const docs=await pool.query(
   `SELECT document_type,message_id FROM general_guide_documents
    WHERE chat_id=$1 AND status='published' AND message_id IS NOT NULL
    AND approved_by IS NOT NULL AND approved_at IS NOT NULL`,[chatId]);
  const labels:Record<string,string>={terms:"🛡 利用規約",rules:"📖 グループルール",
   safety:"🛡 安全ガイドライン",privacy:"🔐 プライバシー",howto:"📋 使い方"};
  const must=["terms","rules","safety","privacy","howto"];
  if(must.some(name=>!docs.rows.some(r=>r.document_type===name)))
   throw new Error("GUIDE_DOCUMENTS_NOT_APPROVED");
  const links:NavLink[]=must.map(name=>{
   const row=docs.rows.find(r=>r.document_type===name);
   return {label:labels[name]!,url:guideMessageUrl(chatId,Number(row.message_id)),
    verified:true};
  });
  const other=await pool.query(
   `SELECT label,destination_url FROM general_guide_links WHERE chat_id=$1
     AND enabled=TRUE AND verified_by IS NOT NULL AND verified_at IS NOT NULL
     ORDER BY link_key`,[chatId]);
  links.push(...other.rows.map(r=>({label:r.label,url:r.destination_url,verified:true})));
  return {links,entries:[]};
 }
 // The other five URLs are provided only from a verified existing-project
 // registry. Never make up a destination, Bot link or feature-release receipt.
 const staticLabels=["クリエーター有料ビデオ投稿",
  "雑談","紹介/招待","操作説明"] as const;
 const stored=await pool.query(
  `SELECT label,destination_url FROM board_posting_menu_links
   WHERE chat_id=$1 AND enabled=TRUE AND verified_by IS NOT NULL
     AND verified_at IS NOT NULL`,[chatId]);
 const links:NavLink[]=stored.rows.map(row=>({
  label:String(row.label),url:String(row.destination_url),verified:true
 }));
 if(links.length!==staticLabels.length||
    links.some(x=>!staticLabels.includes(x.label as typeof staticLabels[number]))||
    new Set(links.map(x=>x.label)).size!==staticLabels.length)
   throw new Error("POSTING_NAV_LINKS_NOT_VERIFIED");
 const gates=await pool.query(
  `SELECT feature FROM gaybbs_feature_release_gates
   WHERE feature IN ('announcement','room','link','search')
     AND enabled=TRUE AND length(source_commit)=40
     AND length(trim(ci_evidence))>0
     AND length(trim(gserver_runtime_evidence))>0
     AND length(trim(telegram_e2e_evidence))>0
     AND approved_by IS NOT NULL`);
 const ready=new Set(gates.rows.map(x=>String(x.feature)));
 if(!["announcement","room","link","search"].every(x=>ready.has(x)))
  throw new Error("POSTING_DM_FEATURES_NOT_RELEASED");
 // Both recruitment (r_) and announcements (m_) refer to the same
 // existing 'announcement' feature, but enter different approved UI paths.
 const entrySpecs=[
  {label:"相手募集",feature:"announcement",prefix:"r_"},
  {label:"募集+Room",feature:"room",prefix:"m_"},
  {label:"告知/予告",feature:"announcement",prefix:"m_"},
  {label:"🔗ボタン作成",feature:"link",prefix:"m_"},
  {label:"検索/フィルター",feature:"search",prefix:"m_"},
 ] as const;
 const entries:EntryLink[]=[];
 for(const entry of entrySpecs){
  const token=newMenuToken();
  const hash=tokenHash(token);
  await pool.query(
   `INSERT INTO board_menu_entry_tokens(token_hash,panel_id,feature,expires_at,enabled)
    VALUES($1,$2,$3,NOW()+INTERVAL '365 days',TRUE)`,
   [hash,panel.panel_id,entry.feature]);
  entries.push({feature:entry.feature,label:entry.label,
   url:"https://t.me/GayBBS_bot?start="+entry.prefix+token,ready:true});
 }
 return {links,entries};
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
 try{
  const {links,entries}=await buildLinks(panel);
  const rendered=renderMenuPanel({
   type:panel.panel_type,board:board(chatId),links,entryLinks:entries,
  });
  const dispatcher=createTelegramDispatcher(telegram);
  const target={chatId,threadId};
  const body={text:rendered.text,buttons:rendered.rows};
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
  const commit=await pool.query(
   `UPDATE board_menu_panels SET state='published',message_id=$2,pinned=TRUE,
    revision=revision+1,updated_at=NOW() WHERE panel_id=$1 AND state='publishing'
    RETURNING panel_id`,[panel.panel_id,messageId]);
  if(commit.rows.length!==1)throw new Error("PANEL_ACK_CONFLICT");
  return {messageId,updatedExisting:updating};
 }catch(e){
  if(deliveryAttempted){
   // A Telegram send/edit/pin can have succeeded even if its ACK failed.
   await markUnknown(panel.panel_id,messageId);
  }else{
   // Validation/configuration failures happened before any external side
   // effect: preserve the previous state so admin can fix links and retry.
   await pool.query(
    `UPDATE board_menu_panels SET state=$2,updated_at=NOW()
      WHERE panel_id=$1 AND state='publishing'`,
    [panel.panel_id,updating?"published":"verified"]);
  }
  throw e;
 }
}
