import test from "node:test";
import assert from "node:assert/strict";
import type {Telegram} from "telegraf";
import {createTelegramDispatcher} from "../src/services/telegramDispatcher.js";

test("one MPB Telegram adapter sends, revises same message id and cancels",async()=>{
 const calls:Array<{method:string;id?:number;text?:string}>=[];
 const fake={
  sendMessage:async(_chat:number,text:string,_opts:unknown)=>{
   calls.push({method:"publish",text});return {message_id:87};
  },
  editMessageText:async(_chat:number,id:number,_inline:unknown,text:string,_opts:unknown)=>{
   calls.push({method:"revise",id,text});return true;
  },
  deleteMessage:async(_chat:number,id:number)=>{
   calls.push({method:"cancel",id});return true;
  },
 } as unknown as Telegram;
 const d=createTelegramDispatcher(fake);
 const t={chatId:-1003847210571,threadId:23};
 const id=await d.publish(t,{text:"original",parseMode:"HTML",
  buttons:[[{text:"案内",url:"https://t.me/GayBBS_bot"}]]});
 assert.equal(id,87);
 await d.revise(t,id,{text:"edited"});
 await d.cancel(t,id);
 assert.deepEqual(calls.map(x=>x.method),["publish","revise","cancel"]);
 assert.equal(calls[1]!.id,87);assert.equal(calls[2]!.id,87);
});
test("never send to guessed, missing or wrong-group topics",async()=>{
 const fake={sendMessage:async()=>{throw new Error("should not send");}} as unknown as Telegram;
 const d=createTelegramDispatcher(fake);
 await assert.rejects(()=>d.publish({chatId:123,threadId:1},{text:"oops"}),/UNVERIFIED/);
 await assert.rejects(()=>d.publish({chatId:-100123,threadId:0},{text:"oops"}),/UNVERIFIED/);
 await assert.rejects(()=>d.revise({chatId:-100123,threadId:1},0,{text:"bad"}),/INVALID/);
});
