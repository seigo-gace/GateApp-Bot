import test from "node:test";
import assert from "node:assert/strict";
import {AREA_BBS_CHAT_ID,GAY_BOARD_CHAT_ID,suppressGroupCommandMenu} from "../src/services/areaMenuSuppression.js";

test("shared group-scoped suppression never touches default/other groups",async()=>{
 const written:any[]=[];
 const api={
  getMe:async()=>({id:8872855519}),
  getChatMember:async()=>({status:"administrator"}),
  setMyCommands:async(commands:unknown,options:unknown)=>{written.push({commands,options});},
  getMyCommands:async()=>[],
 };
 for(const chat of [AREA_BBS_CHAT_ID,GAY_BOARD_CHAT_ID]){
  const before=written.length;
  const result=await suppressGroupCommandMenu(api as never,chat);
  assert.deepEqual(result,["chat","chat_administrators"]);
  assert.equal(written.length-before,2);
  for(const entry of written.slice(before)){
   assert.deepEqual(entry.commands,[]);
   assert.equal(entry.options.scope.chat_id,chat);
   assert.ok(["chat","chat_administrators"].includes(entry.options.scope.type));
  }
 }
 assert.equal(written.length,4);
 await assert.rejects(()=>suppressGroupCommandMenu(api as never,-100123),/NOT_ALLOWED/);
 assert.equal(written.length,4);
});
test("shared suppression refuses non-admin and readback mismatch",async()=>{
 const base={getMe:async()=>({id:8872855519}),setMyCommands:async()=>{},getMyCommands:async()=>[]};
 await assert.rejects(()=>suppressGroupCommandMenu({
  ...base,getChatMember:async()=>({status:"member"})
 } as never,GAY_BOARD_CHAT_ID),/NOT_ADMIN/);
 await assert.rejects(()=>suppressGroupCommandMenu({
  ...base,getChatMember:async()=>({status:"administrator"}),
  getMyCommands:async()=>[{command:"start",description:"start"}]
 } as never,GAY_BOARD_CHAT_ID),/READBACK_NOT_EMPTY/);
});
