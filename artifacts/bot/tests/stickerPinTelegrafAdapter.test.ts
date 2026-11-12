import test from "node:test";
import assert from "node:assert/strict";
import type {Telegram} from "telegraf";
import {createStickerPinTelegrafApi} from "../src/services/stickerPinTelegrafAdapter.js";

test("running GroupBot sends and pins the approved sticker Topic deep-link without another bot",async()=>{
 const sent:{method:string;args:unknown[]}[]=[];
 const telegram={
  getMe:async()=>({id:1000,username:"GayBBS_bot",is_bot:true}),
  getChatMember:async(...args:unknown[])=>{
   sent.push({method:"getChatMember",args});
   return {status:"administrator",can_pin_messages:true};
  },
  sendMessage:async(...args:unknown[])=>{
   sent.push({method:"sendMessage",args});
   return {message_id:500};
  },
  pinChatMessage:async(...args:unknown[])=>{
   sent.push({method:"pinChatMessage",args});
   return true;
  }
 } as unknown as Pick<Telegram,"getMe"|"getChatMember"|"sendMessage"|"pinChatMessage">;
 const api=createStickerPinTelegrafApi(telegram);
 assert.equal((await api("getMe",{}) as {username:string}).username,"GayBBS_bot");
 await api("getChatMember",{chat_id:-1002373696859,user_id:1000});
 const message=await api("sendMessage",{chat_id:-1002373696859,
  message_thread_id:189,text:"📌 投稿はこちら",
  reply_markup:{inline_keyboard:[[{text:"🎨 投稿はこちら",url:"https://t.me/CreateVdobot?start=sticker"}]]}});
 assert.equal((message as {message_id:number}).message_id,500);
 assert.equal(await api("pinChatMessage",{chat_id:-1002373696859,message_id:500}),true);
 assert.deepEqual(sent.map(x=>x.method),["getChatMember","sendMessage","pinChatMessage"]);
 assert.equal((sent[1].args[2] as {message_thread_id:number}).message_thread_id,189);
 assert.equal((sent[2].args[2] as {disable_notification:boolean}).disable_notification,true);
 await assert.rejects(()=>api("getUpdates",{}),/METHOD_NOT_ALLOWED/);
});
test("invalid Topic and message targets are rejected before using Telegram",async()=>{
 let calls=0;
 const dummy={
  getMe:async()=>{calls++;return {};},
  getChatMember:async()=>{calls++;return {};},
  sendMessage:async()=>{calls++;return {};},
  pinChatMessage:async()=>{calls++;return false;}
 } as unknown as Pick<Telegram,"getMe"|"getChatMember"|"sendMessage"|"pinChatMessage">;
 const api=createStickerPinTelegrafApi(dummy);
 await assert.rejects(()=>api("sendMessage",{chat_id:123,message_thread_id:0,
  text:"",reply_markup:{inline_keyboard:[]}}),/SEND_ARGS_INVALID/);
 await assert.rejects(()=>api("pinChatMessage",{chat_id:-100,message_id:0}),/PIN_ARGS_INVALID/);
 assert.equal(calls,0);
});
