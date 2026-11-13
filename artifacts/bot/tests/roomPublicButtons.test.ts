import test from "node:test";
import assert from "node:assert/strict";
import {roomPublicButtons,transitionRoomPublicButtons} from "../src/services/roomPublicButtons.js";

const app="https://t.me/GayBBS_bot?start=a_approved";
const join="https://t.me/GayBBS_bot?start=j_live";
test("scheduled approved ROOM exposes only application, not contact or join",()=>{
 const rows=roomPublicButtons({visibility:"approved_only",state:"scheduled",
  applicationUrl:app,joinUrl:join});
 assert.deepEqual(rows,[{text:"📝 応募する",url:app}]);
});
test("scheduled open ROOM has no premature join",()=>{
 assert.deepEqual(roomPublicButtons({visibility:"public",state:"scheduled",joinUrl:join}),[]);
});
test("live ROOM has join; accepted guests remain gated by DM",()=>{
 const approved=roomPublicButtons({visibility:"approved_only",state:"live",applicationUrl:app,joinUrl:join});
 assert.deepEqual(approved.map(x=>x.text),["📝 応募する","🎥 参加する"]);
 assert.deepEqual(roomPublicButtons({visibility:"public",state:"live",joinUrl:join}).map(x=>x.text),["🎥 参加する"]);
});
test("terminal ROOM has no active actions",()=>{
 for(const state of ["finished","cancelled"] as const)
  assert.deepEqual(roomPublicButtons({visibility:"approved_only",state,applicationUrl:app}),[]);
});
test("lifecycle card update removes old owner contact and pre-LIVE join",()=>{
 const old=[[{text:"🔗 募集者へ連絡",url:app},{text:"🎥 参加する",url:join}],
  [{text:"📝 応募する",url:app}]];
 assert.deepEqual(transitionRoomPublicButtons(old,"scheduled").flat().map(x=>x.text),["📝 応募する"]);
 assert.deepEqual(transitionRoomPublicButtons(old,"live").flat().map(x=>x.text),["🎥 参加する","📝 応募する"]);
 assert.deepEqual(transitionRoomPublicButtons(old,"finished"),[]);
});
