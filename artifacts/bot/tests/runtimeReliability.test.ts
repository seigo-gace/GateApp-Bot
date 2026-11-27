import test from "node:test";
import assert from "node:assert/strict";
import {ActorQueue,boundTelegramCalls} from "../src/services/runtimeReliability.js";
const hold=()=>{let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};};
const unexpected=async()=>{throw Error("unexpected duplicate");};
test("50 same-screen button presses invoke only one in-flight handler",async()=>{
 const q=new ActorQueue(),gate=hold();let executed=0,acked=0;
 const press=()=>q.execute(1,"screen:publish",async()=>{executed++;await gate.promise;},async()=>{acked++;});
 const pending=Array.from({length:50},press);
 await Promise.resolve();assert.equal(executed,1);assert.equal(acked,49);
 gate.release();await Promise.all(pending);assert.equal(q.size,0);
 await press();assert.equal(executed,2);
});
test("different screens, other buttons and text maintain actor ordering without blocking other actors",async()=>{
 const q=new ActorQueue(),gate=hold(),seen:string[]=[];
 const a=q.execute(1,"screen1:button",async()=>{seen.push("a");await gate.promise;},unexpected);
 const b=q.execute(1,"screen2:button",async()=>{seen.push("b");},unexpected);
 const c=q.execute(1,undefined,async()=>{seen.push("c");},unexpected);
 await q.execute(2,"screen1:button",async()=>{seen.push("other");},unexpected);
 assert.deepEqual(seen,["a","other"]);gate.release();await Promise.all([a,b,c]);
 assert.deepEqual(seen,["a","other","b","c"]);assert.equal(q.size,0);
});
test("handler failure releases pending action and allows retry",async()=>{
 const q=new ActorQueue();await assert.rejects(q.execute(1,"same",async()=>{throw Error("failed");},unexpected),/failed/);
 await q.execute(1,"same",async()=>{},unexpected);assert.equal(q.size,0);
});
test("API cancellation is propagated to actual call, not detached or retried",async()=>{
 let count=0;
 const fake={callApi:async(_m:unknown,_p:unknown,o:{signal:AbortSignal})=>{
  count++;return new Promise((_resolve,reject)=>{
   if(o.signal.aborted)reject(Error("aborted"));
   else o.signal.addEventListener("abort",()=>reject(Error("aborted")),{once:true});
  });
 }};
 boundTelegramCalls(fake as never);
 const upstream=new AbortController();
 const result=fake.callApi("sendMessage",{}, {signal:upstream.signal});
 upstream.abort();await assert.rejects(result,/aborted/);assert.equal(count,1);
});
