import test from "node:test";
import assert from "node:assert/strict";
import {createStickerEntryPinService,createStickerEntryPinStore} from "../src/services/stickerTopicEntryPin.js";
import type {VerifiedTopic} from "../src/services/topicRouting.js";

const topic:VerifiedTopic&{groupTitle:string;verified:boolean}={
 id:92,board:"video_chat",purpose:"sticker",chatId:-1002373696859,
 threadId:189,title:"ステッカーの公開と販売",
 groupTitle:"ビデオChatの掲示板",verified:true,
 verifiedAt:new Date("2026-11-12T00:00:00Z"),enabled:true
};
function example({timeout=false,noAdmin=false}={}){
 let state:{status:string;messageId:number|null}|null=null;
 let sends=0,pins=0;
 const bot=async(method:string,params:Record<string,unknown>):Promise<unknown>=>{
  if(method==="getMe")return {id:55,username:"CreateVdobot",is_bot:true};
  if(method==="getChatMember")return {
    status:noAdmin?"member":"administrator",can_pin_messages:!noAdmin
  };
  if(method==="sendMessage"){
    sends++;
    assert.equal(params.chat_id,topic.chatId);
    assert.equal(params.message_thread_id,topic.threadId);
    assert.match(JSON.stringify(params.reply_markup),/start=sticker/);
    if(timeout)throw new Error("Telegram timeout");
    return {message_id:305};
  }
  if(method==="pinChatMessage"){
    pins++;
    assert.equal(params.message_id,305);
    return true;
  }
  throw Error("UNEXPECTED");
 };
 const store={
  claim:async(t:VerifiedTopic,identity:{id:number;username:string})=>{
    assert.equal(t.threadId,189);assert.equal(identity.id,55);
    if(state)return {claimed:false,status:state.status,messageId:state.messageId};
    state={status:"sending",messageId:null};
    return {claimed:true};
  },
  sent:async(_id:number,m:number)=>{if(state){state.status="sent";state.messageId=m;}},
  beginPin:async()=>{if(!state)throw Error("missing");state.status="pin_requested";return state.messageId;},
  pinnedAck:async()=>{if(state)state.status="pinned_ack";},
  unknown:async()=>{if(state)state.status="needs_reconcile";}
 } as unknown as ReturnType<typeof createStickerEntryPinStore>;
 const ensure=createStickerEntryPinService({
   getVerifiedStickerTopic:async()=>({...topic}),creatorBotApi:bot,postingBotApi:bot,store
 });
 return {ensure,get state(){return state;},get sends(){return sends;},get pins(){return pins;}};
}
test("one verified admin sticker Topic creates one DM pin and no duplicate",async()=>{
 const f=example();
 const receipt=await f.ensure();
 assert.equal(receipt.acknowledged,true);
 assert.equal(receipt.readbackVerified,false);
 assert.equal(receipt.messageId,305);
 assert.equal(f.sends,1);assert.equal(f.pins,1);
 const again=await f.ensure();
 assert.equal(again.alreadySubmitted,true);
 assert.equal(f.sends,1);assert.equal(f.pins,1);
});
test("timeout does not blindly repost duplicate entry",async()=>{
 const f=example({timeout:true});
 await assert.rejects(f.ensure(),/timeout/);
 assert.equal(f.state?.status,"needs_reconcile");
 await assert.rejects(f.ensure(),/NEEDS_RECONCILE/);
 assert.equal(f.sends,1);
});
test("Creator bot without pin rights cannot publish",async()=>{
 const f=example({noAdmin:true});
 await assert.rejects(f.ensure(),/ADMIN_REQUIRED/);
 assert.equal(f.sends,0);
});
test("wrong thread, group or speculative message URL cannot pass verified Topic check",async()=>{
 const store=example();
 void store;
 const t={...topic,threadId:0};
 const flow=createStickerEntryPinService({
   getVerifiedStickerTopic:async()=>t,
   creatorBotApi:async()=>{throw Error("should never call Telegram");},
   postingBotApi:async()=>{throw Error("should never call Telegram");},
   store:{claim:async()=>{throw Error("unexpected DB");}} as unknown as ReturnType<typeof createStickerEntryPinStore>
 });
 await assert.rejects(flow(),/TOPIC_NOT_VERIFIED/);
});

test("existing GayBBS administrator pins the verified CreateVdoBot DM link; Creator needs no group role",async()=>{
 let operations:string[]=[],saved:null|{status:string;messageId:number}=null;
 const creator=async(method:string):Promise<unknown>=>{
   assert.equal(method,"getMe");
   operations.push("creator_identity");
   return {id:55,username:"CreateVdobot",is_bot:true};
 };
 const group=async(method:string,params:Record<string,unknown>):Promise<unknown>=>{
   operations.push(method);
   if(method==="getMe")return {id:8086000001,username:"GayBBS_bot",is_bot:true};
   if(method==="getChatMember"){
     assert.equal(params.user_id,8086000001);
     return {status:"administrator",can_pin_messages:true};
   }
   if(method==="sendMessage"){
     const markup=JSON.stringify(params.reply_markup);
     assert.match(markup,/t.me\/CreateVdobot\?start=sticker/);
     assert.equal(params.chat_id,topic.chatId);
     assert.equal(params.message_thread_id,topic.threadId);
     return {message_id:612};
   }
   if(method==="pinChatMessage"){
     assert.equal(params.message_id,612);
     return true;
   }
   throw Error("UNEXPECTED_API");
 };
 const store={
   claim:async()=>({claimed:true}),
   sent:async(_topic:number,id:number)=>{saved={status:"sent",messageId:id};},
   beginPin:async()=>612,
   pinnedAck:async()=>{saved={status:"pinned_ack",messageId:612};},
   unknown:async()=>{throw Error("must not be unknown");}
 } as unknown as ReturnType<typeof createStickerEntryPinStore>;
 const ensure=createStickerEntryPinService({
   getVerifiedStickerTopic:async()=>({...topic}),
   creatorBotApi:creator,postingBotApi:group,store
 });
 const r=await ensure();
 assert.equal(r.acknowledged,true);
 assert.deepEqual(operations,[
   "creator_identity","getMe","getChatMember","sendMessage","pinChatMessage"
 ]);
 assert.equal(saved?.status,"pinned_ack");
});

test("fixed Master-approved CreateVdobot URL needs only the existing GroupBot credential",async()=>{
 const methods:string[]=[];
 let receipt:null|{status:string;messageId:number|null}=null;
 const group=async(method:string,params:Record<string,unknown>):Promise<unknown>=>{
  methods.push(method);
  if(method==="getMe")return {id:1000,username:"GayBBS_bot",is_bot:true};
  if(method==="getChatMember"){
   assert.equal(params.user_id,1000);
   return {status:"administrator",can_pin_messages:true};
  }
  if(method==="sendMessage"){
   assert.equal(params.chat_id,topic.chatId);
   assert.equal(params.message_thread_id,topic.threadId);
   assert.ok(JSON.stringify(params.reply_markup).includes("t.me/CreateVdobot?start=sticker"));
   return {message_id:1007};
  }
  if(method==="pinChatMessage"){
   assert.equal(params.message_id,1007);return true;
  }
  throw Error("STICKER_PIN_UNEXPECTED_API");
 };
 const store={
  claim:async (_t:VerifiedTopic,bot:{id:number|null;username:string})=>{
   assert.equal(bot.id,null);
   assert.equal(bot.username,"CreateVdobot");
   return {claimed:true};
  },
  sent:async(_id:number,m:number)=>{receipt={status:"sent",messageId:m};},
  beginPin:async()=>1007,
  pinnedAck:async()=>{receipt={status:"pinned_ack",messageId:1007};},
  unknown:async()=>{throw Error("MUST_NOT_RECONCILE");}
 } as unknown as ReturnType<typeof createStickerEntryPinStore>;
 const run=createStickerEntryPinService({
  getVerifiedStickerTopic:async()=>({...topic}),
  creatorBotUsername:"CreateVdobot",postingBotApi:group,store
 });
 const value=await run();
 assert.equal(value.acknowledged,true);
 assert.equal(value.readbackVerified,false);
 assert.deepEqual(methods,["getMe","getChatMember","sendMessage","pinChatMessage"]);
 assert.equal(receipt?.status,"pinned_ack");
});
test("wrong public bot username is rejected before any GroupBot or DB mutation",async()=>{
 let calls=0;
 const run=createStickerEntryPinService({
  getVerifiedStickerTopic:async()=>({...topic}),
  creatorBotUsername:"fake_creator_bot",
  postingBotApi:async()=>{calls++;throw Error("UNEXPECTED_MUTATION");},
  store:({claim:async()=>{calls++;throw Error("UNEXPECTED_DB");}}
    as unknown as ReturnType<typeof createStickerEntryPinStore>)
 });
 await assert.rejects(run(),/STICKER_PIN_TARGET_USERNAME_UNAPPROVED/);
 assert.equal(calls,0);
});
