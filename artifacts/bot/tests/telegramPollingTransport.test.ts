import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {once} from "node:events";
import {pollApiRequest,installPollingTransport} from "../src/services/telegramPollingTransport.js";

test("polling transport preserves actual updates, offsets and normal no-drop webhook removal",async()=>{
 const calls:any[]=[];
 const server=http.createServer((req,res)=>{
  let b="";req.on("data",c=>b+=c);req.on("end",()=>{
   calls.push(JSON.parse(b));
   res.writeHead(200,{"content-type":"application/json"});
   res.end(JSON.stringify({ok:true,result:calls.length===1?true:[{update_id:101,message:{message_id:5}}]}));
  });
 });
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const address=server.address();assert.ok(address&&typeof address==="object");
 const request:Parameters<typeof pollApiRequest>[4]=(_url,options,cb)=>http.request("http://127.0.0.1:"+address.port,options,cb);
 try{
  assert.equal(await pollApiRequest("LOCAL_TEST","deleteWebhook",{drop_pending_updates:false},undefined,request),true);
  const update=await pollApiRequest("LOCAL_TEST","getUpdates",{offset:0,timeout:0,allowed_updates:["message"]},undefined,request);
  assert.deepEqual(update,[{update_id:101,message:{message_id:5}}]);
  assert.deepEqual(calls,[{drop_pending_updates:false},{offset:0,timeout:0,allowed_updates:["message"]}]);
  await assert.rejects(pollApiRequest("LOCAL_TEST","getUpdates",{offset:-1},undefined,request),/DISCARD_FORBIDDEN/);
  await assert.rejects(pollApiRequest("LOCAL_TEST","deleteWebhook",{drop_pending_updates:true},undefined,request),/DISCARD_FORBIDDEN/);
  assert.equal(calls.length,2);
  const fake={callApi:async(method:string,payload:unknown)=>({method,payload})};
  installPollingTransport(fake as any,"LOCAL_TEST",request);
  assert.deepEqual(await fake.callApi("sendMessage",{text:"test"}),{method:"sendMessage",payload:{text:"test"}});
  const controller=new AbortController();controller.abort();
  await assert.rejects(pollApiRequest("LOCAL_TEST","getUpdates",{offset:0},controller.signal,request),{name:"AbortError"});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
