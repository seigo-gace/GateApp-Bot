import test from "node:test";
import assert from "node:assert/strict";
import {onlineGateDecision,onlineMemberFromTelegram} from "../src/services/onlineGateAccess.js";

test("being in a Telegram group never substitutes for adopted common Gate approval",()=>{
 assert.equal(onlineGateDecision("member",false,false),"begin_gate");
 assert.equal(onlineGateDecision("not_member",false,false),"begin_gate");
 assert.equal(onlineGateDecision("member",true,false),"open_topic");
 assert.equal(onlineGateDecision("not_member",true,false),"join_after_approval");
 assert.equal(onlineGateDecision("member",true,true),"refuse");
 assert.equal(onlineGateDecision("unknown",true,false),"refuse");
});
test("restricted or uncertain members do not automatically receive topic access",()=>{
 assert.equal(onlineMemberFromTelegram({status:"restricted",is_member:false}),"not_member");
 assert.equal(onlineMemberFromTelegram({status:"restricted",is_member:true}),"member");
 assert.equal(onlineMemberFromTelegram({status:"restricted"}),"unknown");
 assert.equal(onlineMemberFromTelegram({status:"left"}),"not_member");
});
