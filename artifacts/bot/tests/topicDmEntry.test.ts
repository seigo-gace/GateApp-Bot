import test from "node:test";
import assert from "node:assert/strict";
import {parseTopicEntryPayload,TOPIC_ENTRY_TEXT,TOPIC_ENTRY_BUTTON} from "../src/services/topicDmEntry.js";
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
