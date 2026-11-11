import test from "node:test";
import assert from "node:assert/strict";
import {roomCrossPostTargets} from "../src/services/roomCrossPost.js";
import type {VerifiedTopic} from "../src/services/topicRouting.js";
const date=new Date("2026-11-01T00:00:00Z");
function topic(id:number,board:VerifiedTopic["board"],purpose:VerifiedTopic["purpose"],chatId:number,threadId:number):VerifiedTopic{
 return {id,board,purpose,chatId,threadId,title:"検証済み"+id,verifiedAt:date,enabled:true};
}
test("Area recruitment posts once to origin and once to its own group's ROOM Topic",()=>{
 const room=[topic(8,"area_bbs","room",-10011,116),topic(9,"gay_board","room",-10022,4)];
 const recruitment=[topic(2,"area_bbs","announcement",-10011,19)];
 assert.deepEqual(roomCrossPostTargets(room,recruitment,{chatId:-10011,threadId:19}).map(x=>x.topicId),[2,8]);
});
test("Already in ROOM Topic is delivered only once",()=>{
 const room=[topic(8,"area_bbs","room",-10011,116)];
 assert.deepEqual(roomCrossPostTargets(room,[],{chatId:-10011,threadId:116}).map(x=>x.topicId),[8]);
});
test("Missing, multiple or other-group destination cannot be invented",()=>{
 const origin=topic(2,"area_bbs","announcement",-10011,19);
 assert.throws(()=>roomCrossPostTargets([], [origin],{chatId:-10011,threadId:19}),/ROOM_ONLINE_DESTINATION_NOT_VERIFIED/);
 assert.throws(()=>roomCrossPostTargets([topic(8,"area_bbs","room",-10011,116),topic(9,"area_bbs","room",-10011,116)],[origin],{chatId:-10011,threadId:19}),/ROOM_ONLINE_DESTINATION_NOT_VERIFIED/);
 assert.throws(()=>roomCrossPostTargets([topic(8,"gay_board","room",-10022,7)],[origin],{chatId:-10011,threadId:19}),/ROOM_ONLINE_DESTINATION_NOT_VERIFIED/);
 assert.throws(()=>roomCrossPostTargets([topic(8,"area_bbs","room",-10011,116)],[origin],{chatId:-10011,threadId:71}),/ROOM_ORIGIN_AMBIGUOUS_OR_NOT_VERIFIED/);
});

test("ROOM reuses three existing recruitment-verified ONLINE destinations with no ROOM rows",()=>{
 const existing=[
  topic(11,"area_bbs","announcement",-1003847210571,116),
  topic(12,"video_chat","announcement",-1002373696859,1605),
  topic(13,"gay_board","announcement",-1003770334893,4),
 ];
 for(const dest of existing){
  const entry=topic(dest.id+100,dest.board,"announcement",dest.chatId,dest.threadId+2);
  assert.deepEqual(roomCrossPostTargets([], [...existing,entry],
   {chatId:entry.chatId,threadId:entry.threadId}).map(x=>x.topicId),[entry.id,dest.id]);
 }
});
