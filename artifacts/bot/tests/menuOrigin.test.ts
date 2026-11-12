import test from "node:test";
import assert from "node:assert/strict";
import {newMenuToken,tokenHash,decodeMenuStartPayload,assertMenuOrigin} from "../src/services/menuOrigin.js";

test("opaque menu token is stable for DB lookup and never contains chat/thread",()=>{
 const token=newMenuToken(),another=newMenuToken();
 assert.match(token,/^[A-Za-z0-9_-]{32}$/);
 assert.notEqual(token,another);
 assert.equal(decodeMenuStartPayload("m_"+token),token);
 assert.equal(tokenHash(token),tokenHash(token));
 assert.notEqual(tokenHash(token),tokenHash(another));
});
test("user supplied chat or thread in URL is refused",()=>{
 for(const unsafe of ["m_-1003847210571_43","m_3847210571:43","m_test","m_"+newMenuToken()+"_1"]){
  assert.throws(()=>decodeMenuStartPayload(unsafe));
 }
});
test("menu origin binds verified numeric group/thread and allowed feature",()=>{
 const o={chatId:-1003847210571,threadId:25,panelId:1,feature:"announcement" as const};
 assert.doesNotThrow(()=>assertMenuOrigin(o));
 assert.throws(()=>assertMenuOrigin({...o,threadId:0}));
 assert.throws(()=>assertMenuOrigin({...o,chatId:3847210571}));
});
