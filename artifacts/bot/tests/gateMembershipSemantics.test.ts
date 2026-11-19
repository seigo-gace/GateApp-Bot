import test from "node:test";
import assert from "node:assert/strict";
import {hasJoinedBoard} from "../src/modules/gaybbsApproval/admissionRouting.js";
import {onlineMemberFromTelegram} from "../src/services/onlineGateAccess.js";

test("shared Gate and ONLINE do not count departed restricted members as joined",()=>{
 for(const status of ["member","administrator","creator"]){
  assert.equal(hasJoinedBoard({status}),true);
  assert.equal(onlineMemberFromTelegram({status}),"member");
 }
 for(const value of [null,{}, {status:"left"},{status:"kicked"},
   {status:"restricted"},{status:"restricted",is_member:false}]){
  assert.equal(hasJoinedBoard(value),false);
  assert.notEqual(onlineMemberFromTelegram(value),"member");
 }
 assert.equal(hasJoinedBoard({status:"restricted",is_member:true}),true);
 assert.equal(onlineMemberFromTelegram({status:"restricted",is_member:true}),"member");
});
