import test from "node:test";
import assert from "node:assert/strict";
import {parseTopicEntryPayload,canReuseUncertainEntry,TOPIC_ENTRY_TEXT,TOPIC_ENTRY_BUTTON,assertBoundTopicDmEntry,draftTopicEntryOrigin,verifiedOriginTopic} from "../src/services/topicDmEntry.js";
import {APPROVED_POSTING_ROWS} from "../src/services/menuPanelRenderer.js";

test("a forum topic has one DM doorway, not a group-side editor keyboard",()=>{
 assert.ok(TOPIC_ENTRY_TEXT.includes("BotのDM"));
 assert.equal(TOPIC_ENTRY_BUTTON,"📝 投稿メニューを開く");
 assert.deepEqual(APPROVED_POSTING_ROWS.map(row=>row.length),[3,2,2,3]);
 assert.equal(APPROVED_POSTING_ROWS.flat().length,10);
});

test("entry links use opaque p_ token; raw group and topic IDs never accepted",()=>{
 const token="A".repeat(32);
 assert.equal(parseTopicEntryPayload("p_"+token),token);
 for(const bad of ["p_-1003847210571_66","p_66","p_","m_"+token,"p_"+token+"extra","p_"+token+"\n66"]){
  assert.throws(()=>parseTopicEntryPayload(bad),/TOPIC_ENTRY_PAYLOAD_INVALID/);
 }
});

test("pinned entry recruitment may publish only to the bound and still active Topic",()=>{
 const area={chatId:-1003847210571,threadId:1379};
 const other={chatId:-1003770334893,threadId:783};
 assert.doesNotThrow(()=>assertBoundTopicDmEntry(area,area,area));
 assert.throws(()=>assertBoundTopicDmEntry(area,other,area),/TOPIC_ENTRY_CONTEXT_CHANGED/);
 assert.throws(()=>assertBoundTopicDmEntry(area,null,area),/TOPIC_ENTRY_CONTEXT_CHANGED/);
 assert.throws(()=>assertBoundTopicDmEntry(area,area,other),/TOPIC_ENTRY_DESTINATION_MISMATCH/);
 assert.throws(()=>assertBoundTopicDmEntry(null,area,other),/TOPIC_ENTRY_DESTINATION_MISMATCH/);
 assert.doesNotThrow(()=>assertBoundTopicDmEntry(null,null,other));
});

test("saved negative Telegram chat ID remains binding and invalid context fails closed",()=>{
 const area={chatId:-1003847210571,threadId:65};
 const next={chatId:-1003847210571,threadId:66};
 assert.deepEqual(draftTopicEntryOrigin(area.chatId,area.threadId),area);
 assert.deepEqual(draftTopicEntryOrigin(String(area.chatId),String(area.threadId)),area);
 assert.equal(draftTopicEntryOrigin(undefined,undefined),null);
 assert.throws(()=>draftTopicEntryOrigin(area.chatId,undefined),/TOPIC_ENTRY_DRAFT_CONTEXT_INVALID/);
 assert.throws(()=>draftTopicEntryOrigin(1003847210571,65),/TOPIC_ENTRY_DRAFT_CONTEXT_INVALID/);
 assert.throws(()=>draftTopicEntryOrigin(-1001234567890,65),/TOPIC_ENTRY_DRAFT_CONTEXT_INVALID/);
 assert.throws(()=>draftTopicEntryOrigin(area.chatId,0),/TOPIC_ENTRY_DRAFT_CONTEXT_INVALID/);
 assert.throws(()=>assertBoundTopicDmEntry(draftTopicEntryOrigin(area.chatId,area.threadId),next,next),/TOPIC_ENTRY_CONTEXT_CHANGED/);
 assert.doesNotThrow(()=>assertBoundTopicDmEntry(draftTopicEntryOrigin(area.chatId,area.threadId),area,area));
});

test("M2 recruitment origin is bound just like a pinned forum entry",()=>{
 const fromMenu={chatId:-1003847210571,threadId:65};
 const changedMenu={chatId:-1003847210571,threadId:66};
 const otherBoard={chatId:-1003770334893,threadId:210};
 const saved=draftTopicEntryOrigin(String(fromMenu.chatId),String(fromMenu.threadId));
 assert.doesNotThrow(()=>assertBoundTopicDmEntry(saved,fromMenu,fromMenu));
 assert.throws(()=>assertBoundTopicDmEntry(saved,changedMenu,changedMenu),/TOPIC_ENTRY_CONTEXT_CHANGED/);
 assert.throws(()=>assertBoundTopicDmEntry(saved,null,fromMenu),/TOPIC_ENTRY_CONTEXT_CHANGED/);
 assert.throws(()=>assertBoundTopicDmEntry(saved,fromMenu,otherBoard),/TOPIC_ENTRY_DESTINATION_MISMATCH/);
});

test("相手募集 and 募集+Room resolve exactly the authenticated Topic, never another Topic",()=>{
 const a={id:3,chatId:-1003847210571,threadId:116};
 const b={id:4,chatId:-1003847210571,threadId:1379};
 const topics=[a,b];
 assert.equal(verifiedOriginTopic(topics,{chatId:a.chatId,threadId:a.threadId})?.id,3);
 assert.equal(verifiedOriginTopic(topics,{chatId:b.chatId,threadId:b.threadId})?.id,4);
 assert.equal(verifiedOriginTopic(topics,{chatId:a.chatId,threadId:555}),null);
 assert.equal(verifiedOriginTopic(topics,null),null);
});

test("uncertain entry can be repaired only when original Telegram message ID exists",()=>{
 assert.equal(canReuseUncertainEntry("needs_reconcile",1407),true);
 assert.equal(canReuseUncertainEntry("publishing","1407"),true);
 for(const state of ["verified","published","deleted"]){
  assert.equal(canReuseUncertainEntry(state,1407),false);
 }
 for(const id of [null,undefined,0,-1,"abc",1.2]){
  assert.equal(canReuseUncertainEntry("needs_reconcile",id),false);
 }
});
