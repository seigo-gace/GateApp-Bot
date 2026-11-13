import test from "node:test";
import assert from "node:assert/strict";
import type {Telegram} from "telegraf";
import {handleTumblrBridge,startTumblrBridge} from "../src/services/tumblrBridgeServer.js";

test("existing Bot works without optional Tumblr owner bridge settings",()=>{
 const original=process.env.TUMBLR_BRIDGE_KEY_FILE;
 const prev=process.env.TUMBLR_BRIDGE_OWNER_ID;
 delete process.env.TUMBLR_BRIDGE_KEY_FILE;
 delete process.env.TUMBLR_BRIDGE_OWNER_ID;
 try{
  assert.equal(startTumblrBridge({} as Telegram),null);
 }finally{
  if(original!==undefined)process.env.TUMBLR_BRIDGE_KEY_FILE=original;
  if(prev!==undefined)process.env.TUMBLR_BRIDGE_OWNER_ID=prev;
 }
});

test("unverified or arbitrary destinations never call existing Telegram",async()=>{
 const telegram={getMe(){throw new Error("should not use telegram")}} as unknown as Telegram;
 await assert.rejects(()=>handleTumblrBridge(telegram,7,
  {action:"authorize",destination:"-1001"}),/BRIDGE_TARGET_INVALID/);
 await assert.rejects(()=>handleTumblrBridge(telegram,0,
  {action:"publish",destination:"1",operation_key:"x",text:"test"}),/BRIDGE_TARGET_INVALID/);
});
