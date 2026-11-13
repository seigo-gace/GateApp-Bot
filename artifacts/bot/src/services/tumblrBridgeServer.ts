/** Minimal, loopback-only Tumblr -> existing GayBBS/GATE/MPB integration.
 * Same Bot token, existing approval tables, posting topic registry, delivery
 * ledger, and Telegram dispatcher. No second Bot or queue.
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import type { Telegram } from "telegraf";
import * as targetRepo from "../repositories/targetRepo.js";
import { onlineMembership } from "./onlineGateAccess.js";
import { commonGayBbsApproval } from "../modules/gaybbsApproval/handlers.js";
import { getVerifiedTopic } from "./postingDelivery.js";
import { assertFeatureReleased, publishPost } from "./publishService.js";
import { escapeProfileHtml } from "./profileCore.js";
import { pool } from "../db/index.js";

export type TumblrBridgeInput = {
  action: "authorize"|"member"|"publish"|"lookup"|"readback";
  destination: string;
  user_id?: string;
  operation_key?: string;
  message_id?: string;
  text?: string;
};
export type TumblrBridgeOutput = {
  verified?: boolean; authorized?: boolean; message_id?: string;
};

export async function handleTumblrBridge(
 telegram: Telegram, input: TumblrBridgeInput
): Promise<TumblrBridgeOutput> {
 if (typeof input?.destination!=="string"||
     !/^[1-9][0-9]{0,12}$/.test(input.destination))
   throw new Error("BRIDGE_TARGET_INVALID");
 const topicId=Number(input.destination);
 const topic=await getVerifiedTopic(topicId,"announcement");
 const group=await targetRepo.getTargetByChatId(topic.chatId);
 const ownerId=Number(group?.owner_user_id);
 if(!group||group.target_type!=="entry_group"||
    !Number.isSafeInteger(ownerId)||ownerId<=0)
   throw new Error("BRIDGE_GROUP_UNVERIFIED");
 if(input.action==="authorize"){
   await assertFeatureReleased("announcement");
   return {authorized:true};
 }
 if(input.action==="member"){
   const user=Number(input.user_id);
   if(!Number.isSafeInteger(user)||user<=0)throw new Error("BRIDGE_MEMBER_INVALID");
   const member=await onlineMembership(telegram,topic.chatId,user);
   if(member!=="member")return {verified:false};
   const approved=await commonGayBbsApproval(telegram,user,group.target_id);
   return {verified:approved===true};
 }
 // Existing MPB ledger is authoritative; readback does not repost.
 if(input.action==="readback"){
   if(!input.message_id || !/^[1-9][0-9]{0,15}$/.test(input.message_id))
     throw new Error("BRIDGE_MESSAGE_INVALID");
   const r=await pool.query<{status:string;telegram_message_id:string|null}>(
    "SELECT status,telegram_message_id FROM posting_deliveries WHERE telegram_message_id=$1 AND owner_user_id=$2 AND posting_topic_id=$3 AND source_type='announcement' AND status='sent'",
    [input.message_id,ownerId,topicId]);
   return {verified:r.rows.length===1};
 }
 const op=input.operation_key;
 if(typeof op!=="string"||! /^[a-zA-Z0-9_-]{1,80}$/.test(op))
   throw new Error("BRIDGE_OPERATION_INVALID");
 const key="announcement:"+op+":1:"+topicId;
 if(input.action==="lookup"){
   const r=await pool.query<{status:string;telegram_message_id:string|null}>(
    "SELECT status,telegram_message_id FROM posting_deliveries WHERE operation_key=$1 AND owner_user_id=$2 AND posting_topic_id=$3",
    [key,ownerId,topicId]);
   const row=r.rows[0];
   if(!row||row.status!=="sent"||!row.telegram_message_id)return {verified:false};
   const messageId=String(row.telegram_message_id);
   return {verified:true,message_id:messageId};
 }
 if(input.action==="publish"){
   if(typeof input.text!=="string"||!input.text.trim()||input.text.length>3500)
     throw new Error("BRIDGE_TEXT_INVALID");
   const result=await publishPost(telegram,{
     sourceType:"announcement",destinationPurpose:"announcement",
     sourceId:op,ownerId,revision:1,topicId,text:escapeProfileHtml(input.text),
     approved:true,
   });
   return {verified:true,message_id:String(result.messageId)};
 }
 throw new Error("BRIDGE_ACTION_INVALID");
}

export function startTumblrBridge(telegram: Telegram): Server|null {
 const file=process.env.TUMBLR_BRIDGE_KEY_FILE;
 if(!file)return null; // Existing Bot remains unchanged until configured.
 const key=readFileSync(file,"utf8").trim();
 if(key.length<32)throw new Error("BRIDGE_KEY_INVALID");
 const port=Number(process.env.TUMBLR_BRIDGE_PORT || "8876");
 if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error("BRIDGE_PORT_INVALID");
 const server=createServer(async(req,res)=>{
   const respond=(status:number,data:Record<string,unknown>)=>{
     res.writeHead(status,{"content-type":"application/json; charset=utf-8",
       "cache-control":"no-store"});
     res.end(JSON.stringify(data));
   };
   if(req.method!=="POST"||req.url!=="/internal/tumblr"){
     respond(404,{ok:false});return;
   }
   const bearer=req.headers.authorization?.startsWith("Bearer ")
     ?req.headers.authorization.slice(7):"";
   const a=Buffer.from(bearer),b=Buffer.from(key);
   if(a.length!==b.length||!timingSafeEqual(a,b)){
     respond(401,{ok:false});return;
   }
   let size=0,body="";
   try{
     for await(const chunk of req){
       size+=Buffer.byteLength(chunk);
       if(size>8192){respond(413,{ok:false});return}
       body+=String(chunk);
     }
     const input=JSON.parse(body) as TumblrBridgeInput;
     const value=await handleTumblrBridge(telegram,input);
     respond(200,{ok:true,...value});
   }catch(error){
     const message=error instanceof Error?error.message:"BRIDGE_ERROR";
     const known=/^(BRIDGE_|TOPIC_NOT_VERIFIED|FEATURE_RELEASE_NOT_VERIFIED|PUBLISH_)/.test(message);
     respond(known?400:503,{ok:false,error:known?message:"BRIDGE_UNAVAILABLE"});
   }
 });
 server.listen(port,"127.0.0.1");
 return server;
}
