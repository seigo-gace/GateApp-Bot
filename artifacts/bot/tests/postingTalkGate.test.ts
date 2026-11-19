import test from "node:test";
import assert from "node:assert/strict";
import {TALK_TOPICS,canDirectTalkTopic} from "../src/bot/postingMenuUtilityHandlers.js";
import {BOARD_GROUP_CHAT_IDS} from "../src/services/topicRouting.js";
import {talkDestination} from "../src/services/talkDestinationContract.js";

test("talk keeps all three established topic links, in original order",()=>{
 assert.deepEqual(TALK_TOPICS.map(x=>x.url),[
  "https://t.me/c/3847210571/44",
  "https://t.me/c/2373696859/4291",
  "https://t.me/c/3770334893/789",
 ]);
 assert.equal(new Set(Object.values(BOARD_GROUP_CHAT_IDS)).size,3);
});
test("talk direct link requires both existing common gate approval and verified membership",()=>{
 for(const member of ["member","not_member","unknown"] as const){
  for(const approved of [true,false]){
   assert.equal(canDirectTalkTopic(approved,member),approved&&member==="member");
  }
 }
});

test("the requested topic is stable through an existing admission attempt",()=>{
 for(const [index,topic] of TALK_TOPICS.entries()){
  assert.deepEqual(talkDestination(index),topic);
  assert.equal(topic.chatId,Object.values(BOARD_GROUP_CHAT_IDS)[index]);
 }
 assert.equal(talkDestination(-1),null);
 assert.equal(talkDestination(3),null);
 assert.equal(talkDestination(undefined),null);
});

test("blacklisted users cannot receive direct talk URLs even with approval and membership",()=>{
 for(const member of ["member","not_member","unknown"] as const){
  for(const approved of [true,false]){
   assert.equal(canDirectTalkTopic(approved,member,true),false);
  }
 }
 assert.equal(canDirectTalkTopic(true,"member",false),true);
});
