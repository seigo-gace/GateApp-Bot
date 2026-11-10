import test from "node:test";
import assert from "node:assert/strict";
import {roomCrossPostTargets} from "../src/services/roomCrossPost.js";
import type {VerifiedTopic} from "../src/services/topicRouting.js";
const date=new Date("2026-11-01T00:00:00Z");
function topic(id:number,board:VerifiedTopic["board"],purpose:VerifiedTopic["purpose"],chatId:number,threadId:number):VerifiedTopic{
 return {id,board,purpose,chatId,threadId,title:"検証済み"+id,verifiedAt:date,enabled:true};
}
test("Area recruitment posts once to origin and once to its own group's ROOM Topic",()=>{
 const room=[topic(8,"area_bbs","room",-10011,1605),topic(9,"gay_board","room",-10022,70)];
 const recruitment=[topic(2,"area_bbs","announcement",-10011,19)];
 assert.deepEqual(roomCrossPostTargets(room,recruitment,{chatId:-10011,threadId:19}).map(x=>x.topicId),[2,8]);
});
test("Already in ROOM Topic is delivered only once",()=>{
 const room=[topic(8,"area_bbs","room",-10011,1605)];
 assert.deepEqual(roomCrossPostTargets(room,[],{chatId:-10011,threadId:1605}).map(x=>x.topicId),[8]);
});
test("Missing, multiple or other-group destination cannot be invented",()=>{
 const origin=topic(2,"area_bbs","announcement",-10011,19);
 assert.throws(()=>roomCrossPostTargets([], [origin],{chatId:-10011,threadId:19}),/ROOM_ONLINE_DESTINATION_NOT_VERIFIED/);
 assert.throws(()=>roomCrossPostTargets([topic(8,"area_bbs","room",-10011,5),topic(9,"area_bbs","room",-10011,6)],[origin],{chatId:-10011,threadId:19}),/ROOM_ONLINE_DESTINATION_NOT_VERIFIED/);
 assert.throws(()=>roomCrossPostTargets([topic(8,"gay_board","room",-10022,7)],[origin],{chatId:-10011,threadId:19}),/ROOM_ONLINE_DESTINATION_NOT_VERIFIED/);
 assert.throws(()=>roomCrossPostTargets([topic(8,"area_bbs","room",-10011,5)],[origin],{chatId:-10011,threadId:71}),/ROOM_ORIGIN_AMBIGUOUS_OR_NOT_VERIFIED/);
});
