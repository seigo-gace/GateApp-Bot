import test from "node:test";
import assert from "node:assert/strict";
import {parseTopicEntryPayload,topicEntryDirectDmUrl,canReuseUncertainEntry,TOPIC_ENTRY_TEXT,TOPIC_ENTRY_BUTTON,assertBoundTopicDmEntry,draftTopicEntryOrigin,verifiedOriginTopic,permittedTopicDmEntry,VIDEO_SPECIALIST_ENTRY_TOPIC_IDS,isAreaBlockTopic,AREA_BLOCK_TOPIC_IDS} from "../src/services/topicDmEntry.js";
import {APPROVED_POSTING_ROWS} from "../src/services/menuPanelRenderer.js";

test("a forum topic has one DM doorway, not a group-side editor keyboard",()=>{
 assert.ok(TOPIC_ENTRY_TEXT.includes("BotのDM"));
 assert.equal(TOPIC_ENTRY_BUTTON,"📝 投稿メニューを開く");
 assert.deepEqual(APPROVED_POSTING_ROWS.map(row=>row.length),[3,2,2,3,1]);
 assert.equal(APPROVED_POSTING_ROWS.flat().length,11);
});

test("entry links use opaque p_ token; raw group and topic IDs never accepted",()=>{
 const token="A".repeat(32);
 assert.equal(parseTopicEntryPayload("p_"+token),token);
 for(const bad of ["p_-1003847210571_66","p_66","p_","m_"+token,"p_"+token+"extra","p_"+token+"\n66"]){
  assert.throws(()=>parseTopicEntryPayload(bad),/TOPIC_ENTRY_PAYLOAD_INVALID/);
 }
});

test("pinned entry URL opens the Bot DM with opaque topic origin, not a callback toast",()=>{
 const token="A".repeat(32);
 assert.equal(topicEntryDirectDmUrl(token),"https://t.me/GayBBS_bot?start=p_"+token);
 for(const bad of ["", "abc", "-1002373696859_1605"]){
  assert.throws(()=>topicEntryDirectDmUrl(bad),/TOPIC_ENTRY_TOKEN_INVALID/);
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

test("Master: video forum allows explicitly approved video-chat, paid video, sticker and profile entrances",()=>{
 const video=-1002373696859;
 assert.deepEqual([...VIDEO_SPECIALIST_ENTRY_TOPIC_IDS].sort((a,b)=>a-b),[1605,1613,1695,4640]);
 for(const t of [1605,1613,1695,4640]){
  assert.equal(permittedTopicDmEntry(video,t),true);
  assert.deepEqual(draftTopicEntryOrigin(video,t),{chatId:video,threadId:t});
 }
 for(const t of [1,1634,1723,1724,4291,4672]){
  assert.equal(permittedTopicDmEntry(video,t),false);
  assert.throws(()=>draftTopicEntryOrigin(video,t),/TOPIC_ENTRY_DRAFT_CONTEXT_INVALID/);
 }
});

test("Master: no posting entry button on announcement Topic 1 in any group",()=>{
 for(const chat of [-1003847210571,-1002373696859,-1003770334893]){
  assert.equal(permittedTopicDmEntry(chat,1),false);
 }
 assert.equal(permittedTopicDmEntry(-1003847210571,1379),true);
 assert.equal(permittedTopicDmEntry(-1003770334893,783),true);
 assert.equal(permittedTopicDmEntry(-1003847210571,116),true);
});

test("Master: thirteen area navigation blocks are excluded from public posting-button placement only",()=>{
 assert.equal(AREA_BLOCK_TOPIC_IDS.size,13);
 for(const id of [49,621,990,991,992,993,994,995,996,997,998,999,104]){
  assert.equal(isAreaBlockTopic(-1003847210571,id),true);
  assert.equal(isAreaBlockTopic(-1003770334893,id),false);
 }
 for(const id of [50,51,65,81,92,96,102,103,116,1379])assert.equal(isAreaBlockTopic(-1003847210571,id),false);
});
