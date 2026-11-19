import test from "node:test";
import assert from "node:assert/strict";
import {TALK_TOPICS,canDirectTalkTopic} from "../src/bot/postingMenuUtilityHandlers.js";
import {BOARD_GROUP_CHAT_IDS} from "../src/services/topicRouting.js";

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
