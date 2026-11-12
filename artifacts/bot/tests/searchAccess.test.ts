import test from "node:test";
import assert from "node:assert/strict";
import {authorizedSearchGroupIds,canReadGroupMembership} from "../src/services/searchAccess.js";
import {BOARD_GROUP_CHAT_IDS} from "../src/services/topicRouting.js";
test("only current Telegram members and qualifying restricted members can read a board",()=>{
 for(const status of ["member","administrator","creator"])
  assert.equal(canReadGroupMembership({status}),true);
 assert.equal(canReadGroupMembership({status:"restricted",is_member:true}),true);
 for(const status of ["left","kicked","restricted"])
  assert.equal(canReadGroupMembership({status}),false);
});
test("search authorization is per group and network errors fail closed",async()=>{
 const ids=Object.values(BOARD_GROUP_CHAT_IDS);
 const fake={
  getChatMember:async(chat:number,user:number)=>{
   assert.equal(user,77123);
   if(chat===ids[0])return {status:"member"};
   if(chat===ids[1])return {status:"left"};
   throw Error("Telegram API temporarily unavailable");
  }
 } as any;
 assert.deepEqual(await authorizedSearchGroupIds(fake,77123),[ids[0]]);
 await assert.rejects(()=>authorizedSearchGroupIds(fake,-1),/SEARCH_USER_INVALID/);
});
