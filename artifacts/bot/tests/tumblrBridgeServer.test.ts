import test from "node:test";
import assert from "node:assert/strict";
import type {Telegram} from "telegraf";
import {handleTumblrBridge,startTumblrBridge,validateCmFooter,validateOriginalButtons} from "../src/services/tumblrBridgeServer.js";

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
  [[{text:"PR / URL",url:"https://[::1]/"}]],
  [[{text:"PR / URL",url:"https://127.0.0.1/"}]],
  Array.from({length:4},()=>[{text:"PR / URL",url:"https://example.org"}]),
  [[{text:"PR / A",url:"https://example.org"},{text:"PR / B",url:"https://example.org"}]],
 ]){
  assert.throws(()=>validateCmFooter(invalid),/BRIDGE_CM_INVALID/);
 }
});

test("existing HTTPS URL rows remain in order and invalid rows fail closed",()=>{
 const original=[
  [{text:"応募",url:"https://example.org/apply"},
   {text:"詳しく",url:"https://example.org/details"}],
  [{text:"戻る",url:"https://example.org/back"}]
 ];
 const cm=[[{text:"PR / 提携",url:"https://sponsor.example/ad"}]];
 assert.deepEqual([...validateOriginalButtons(original),...validateCmFooter(cm)], [...original,...cm]);
 assert.deepEqual(validateOriginalButtons(undefined),[]);
 for(const invalid of [
   [[{text:"応募",callback_data:"private"}]],
   [[{text:"応募",url:"http://example.org"}]],
   [[{text:"応募",url:"https://user:pass@example.org"}]],
   [[{text:"応募",url:"https://localhost:8080"}]],
   [[{text:"応募",url:"https://localhost/path"}]],
   [[{text:"応募",url:"https://service.local/path"}]],
   [[{text:"応募",url:"https://127.0.0.1/path"}]],
   [[{text:"応募",url:"https://[::1]/path"}]],
   [[{text:"応募",url:"https://example.org/with\\nnewline"}]],
   Array.from({length:21},()=>[{text:"応募",url:"https://example.org"}]),
   [[{text:"",url:"https://example.org"}]]
 ])assert.throws(()=>validateOriginalButtons(invalid),/BRIDGE_BUTTONS_INVALID/);
});
