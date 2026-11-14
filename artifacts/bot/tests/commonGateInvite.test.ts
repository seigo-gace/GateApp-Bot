import test from "node:test";
import assert from "node:assert/strict";
import {gateInviteCopyButton} from "../src/services/commonGateInvite.js";

test("one-tap invitation copies the existing common questionnaire URL",()=>{
 const url="https://t.me/GayBBS_bot?start=gate_existing";
 assert.deepEqual(gateInviteCopyButton("紹介/招待",url),{text:"紹介/招待",copy_text:{text:url}});
});
test("non-Gate links are refused",()=>{
 assert.throws(()=>gateInviteCopyButton("紹介/招待","https://t.me/GayBBS_bot?start=invite"),/COMMON_GATE_URL_INVALID/);
 assert.throws(()=>gateInviteCopyButton("紹介/招待","https://example.com"),/COMMON_GATE_URL_INVALID/);
});
