import test from "node:test";
import assert from "node:assert/strict";
import {bootstrapExistingStickerTopic} from "../src/services/stickerTopicBootstrap.js";

function setup(mode:"valid"|"wrong_thread"|"send_unknown"="valid"){
 const queries:string[]=[],apiCalls:{method:string;params:Record<string,unknown>}[]=[];
 let receipt="none",priorSent=false;
 const client={
  query:async(sql:string,args:unknown[]=[]):Promise<{rows:Record<string,unknown>[];rowCount:number}>=>{
   queries.push(sql);
   if(sql.includes("SELECT purpose,title FROM posting_topics"))return {rows:[],rowCount:0};
   if(sql.startsWith("INSERT INTO posting_topics"))return {rows:[{topic_id:17}],rowCount:1};
   if(sql.startsWith("INSERT INTO posting_sticker_entry_pins")){
    if(priorSent)return {rows:[],rowCount:0};
    receipt="sending";return {rows:[{status:"sending"}],rowCount:1};
   }
   if(sql.startsWith("UPDATE posting_topics SET")){
    return {rows:[{topic_id:17}],rowCount:1};
   }
   if(sql.startsWith("UPDATE posting_sticker_entry_pins")){
    if(sql.includes("SET status='pinned_ack'"))receipt="pinned_ack";
    else if(sql.includes("SET status='sent'"))receipt="sent";
    else if(sql.includes("status='needs_reconcile'"))receipt="needs_reconcile";
    return {rows:[{topic_id:17}],rowCount:1};
   }
   return {rows:[],rowCount:0};
  },
  release:()=>{}
 };
 const api=async(method:string,params:Record<string,unknown>)=>{
  apiCalls.push({method,params});
  if(method==="getMe")return {id:999,username:"GayBBS_bot",is_bot:true};
  if(method==="getChat")return {id:-1002373696859,type:"supergroup",is_forum:true};
  if(method==="getChatMember")return {status:"administrator",can_pin_messages:true};
  if(method==="sendMessage"){
   if(mode==="send_unknown")throw Error("Telegram timeout");
   return {message_id:5791,chat:{id:-1002373696859},
    message_thread_id:mode==="wrong_thread"?1605:4640,
    is_topic_message:true};
  }
  if(method==="deleteMessage")return true;
  if(method==="pinChatMessage")return true;
  throw Error("UNEXPECTED_API");
 };
 const pool={connect:async()=>client};
 return {pool,api,queries,apiCalls,get receipt(){return receipt;}};
}
test("bootstrap writes receipt before Telegram and pins ONLY verified original Topic thread",async()=>{
 const f=setup();
 const result=await bootstrapExistingStickerTopic(f);
 assert.equal(result.acknowledged,true);
 assert.equal(result.threadVerified,true);
 assert.equal(result.messageId,5791);
 assert.equal(f.receipt,"pinned_ack");
 const call=f.apiCalls.find(x=>x.method==="sendMessage");
 assert.equal(call?.params.message_thread_id,4640);
 assert.match(JSON.stringify(call?.params.reply_markup),/CreateVdobot\\?start=sticker/);
 assert.ok(f.queries.findIndex(x=>x.startsWith("INSERT INTO posting_sticker_entry_pins"))<
  f.queries.findIndex(x=>x.startsWith("UPDATE posting_sticker_entry_pins")));
 assert.deepEqual(f.apiCalls.filter(x=>x.method==="pinChatMessage")
  .map(x=>x.params.message_id),[5791]);
});
test("bootstrap refuses a different Telegram thread, deletes wrong post and never pins",async()=>{
 const f=setup("wrong_thread");
 await assert.rejects(()=>bootstrapExistingStickerTopic(f),
  /SEND_THREAD_NOT_CONFIRMED/);
 assert.equal(f.receipt,"sending");
 assert.equal(f.apiCalls.filter(x=>x.method==="pinChatMessage").length,0);
 assert.equal(f.apiCalls.filter(x=>x.method==="deleteMessage").length,1);
});
test("unknown send remains locked and never claims Telegram pin completion",async()=>{
 const f=setup("send_unknown");
 await assert.rejects(()=>bootstrapExistingStickerTopic(f),
  /SEND_FAILED_OR_UNKNOWN/);
 assert.equal(f.receipt,"sending");
 assert.equal(f.apiCalls.filter(x=>x.method==="pinChatMessage").length,0);
});
