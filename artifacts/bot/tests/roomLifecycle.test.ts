import test from "node:test";
import assert from "node:assert/strict";
import {roomTransition} from "../src/services/roomLifecycle.js";

test("ROOM host transitions follow adopted v2 with no automatic Jitsi controls",()=>{
 assert.equal(roomTransition("draft","prepare").state,"ready");
 assert.equal(roomTransition("ready","start").state,"live");
 assert.equal(roomTransition("live","finish").state,"finished");
 assert.equal(roomTransition("live","cancel").state,"cancelled");
 assert.throws(()=>roomTransition("finished","start"),/INVALID/);
 assert.throws(()=>roomTransition("draft","start"),/INVALID/);
 assert.throws(()=>roomTransition("cancelled","prepare"),/INVALID/);
});
test("postponement and schedule require a valid future time",()=>{
 const date=new Date(Date.now()+3600000);
 assert.equal(roomTransition("draft","schedule",date).state,"scheduled");
 assert.equal(roomTransition("live","postpone",date).state,"postponed");
 assert.throws(()=>roomTransition("live","postpone"),/ROOM_FUTURE_DATE_REQUIRED/);
 assert.throws(()=>roomTransition("draft","schedule",new Date(Date.now()-3600000)),/ROOM_FUTURE_DATE_REQUIRED/);
});
