import test from "node:test";
import assert from "node:assert/strict";
import {onlineMemberFromTelegram,onlineGateDecision} from "../src/services/onlineGateAccess.js";
import {ONLINE_GROUPS,requireOnlineBotUsername} from "../src/services/onlineGateRoutes.js";
import {ONLINE_HISTORICAL_TARGETS} from "../src/services/onlineRoomBoard.js";

test("ONLINE route ledger references only three existing target groups/ROOM topics",()=>{
 assert.deepEqual(Object.keys(ONLINE_GROUPS),["area_bbs","video_chat","gay_board"]);
 for(const key of ["area_bbs","video_chat","gay_board"] as const){
  assert.equal(ONLINE_GROUPS[key].topicUrl,ONLINE_HISTORICAL_TARGETS[key]);
  assert.match(ONLINE_GROUPS[key].topicUrl,
   new RegExp("^https://t\\.me/c/"+String(ONLINE_GROUPS[key].chatId).replace("-100","")+"/[1-9][0-9]*$"));
 }
});
test("membership state cannot be inferred from Gate approval alone",()=>{
 assert.equal(onlineMemberFromTelegram({status:"member"}),"member");
 assert.equal(onlineMemberFromTelegram({status:"creator"}),"member");
 assert.equal(onlineMemberFromTelegram({status:"restricted",is_member:true}),"member");
 assert.equal(onlineMemberFromTelegram({status:"restricted",is_member:false}),"not_member");
 assert.equal(onlineMemberFromTelegram({status:"left"}),"not_member");
 assert.equal(onlineMemberFromTelegram({status:"kicked"}),"not_member");
 assert.equal(onlineMemberFromTelegram(null),"unknown");
 assert.equal(onlineMemberFromTelegram({status:"restricted"}),"unknown");
});
test("approved member sees topic, approved nonmember gets join, unapproved gets Gate",()=>{
 assert.equal(onlineGateDecision("member",true,false),"open_topic");
 assert.equal(onlineGateDecision("member",false,false),"open_topic");
 assert.equal(onlineGateDecision("not_member",true,false),"join_after_approval");
 assert.equal(onlineGateDecision("not_member",false,false),"begin_gate");
 assert.equal(onlineGateDecision("unknown",true,false),"refuse");
 assert.equal(onlineGateDecision("member",true,true),"refuse");
});
test("ONLINE deep link bot identity is read from runtime and never assumed",()=>{
 assert.equal(requireOnlineBotUsername("ExistingGate_bot"),"ExistingGate_bot");
 assert.equal(requireOnlineBotUsername("ExistingGateBot"),"ExistingGateBot");
 assert.throws(()=>requireOnlineBotUsername(""),/IDENTITY_UNVERIFIED/);
 assert.throws(()=>requireOnlineBotUsername("https://t.me/Test_bot"),/IDENTITY_UNVERIFIED/);
 assert.throws(()=>requireOnlineBotUsername("UserNotAgent"),/IDENTITY_UNVERIFIED/);
});
