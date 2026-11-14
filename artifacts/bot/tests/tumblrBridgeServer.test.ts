import test from "node:test";
import assert from "node:assert/strict";
import type {Telegram} from "telegraf";
import {handleTumblrBridge,startTumblrBridge,validateCmFooter} from "../src/services/tumblrBridgeServer.js";

test("existing Bot works without optional Tumblr owner bridge settings",()=>{
 const original=process.env.TUMBLR_BRIDGE_KEY_FILE;
 delete process.env.TUMBLR_BRIDGE_KEY_FILE;
 try{
  assert.equal(startTumblrBridge({} as Telegram),null);
 }finally{
  if(original!==undefined)process.env.TUMBLR_BRIDGE_KEY_FILE=original;
 }
});

test("unverified or arbitrary destinations never call existing Telegram",async()=>{
 const telegram={getMe(){throw new Error("should not use telegram")}} as unknown as Telegram;
 await assert.rejects(()=>handleTumblrBridge(telegram,
  {action:"authorize",destination:"-1001"}),/BRIDGE_TARGET_INVALID/);
 await assert.rejects(()=>handleTumblrBridge(telegram,
  {action:"publish",destination:"0",operation_key:"x",text:"test"}),/BRIDGE_TARGET_INVALID/);
});

test("CM footer accepts up to three PR HTTPS URL rows without changing other buttons",()=>{
 const rows=[[{text:"PR / 案内",url:"https://example.org/cm"}]];
 assert.deepEqual(validateCmFooter(rows),rows);
 assert.deepEqual(validateCmFooter(undefined),[]);
 for(const invalid of [
  [[{text:"悪意のリンク",url:"https://example.org"}]],
  [[{text:"PR / URL",url:"http://example.org"}]],
  [[{text:"PR / URL",url:"https://user:pass@example.org"}]],
  Array.from({length:4},()=>[{text:"PR / URL",url:"https://example.org"}]),
  [[{text:"PR / A",url:"https://example.org"},{text:"PR / B",url:"https://example.org"}]],
 ]){
  assert.throws(()=>validateCmFooter(invalid),/BRIDGE_CM_INVALID/);
 }
});
