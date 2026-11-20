import test from "node:test";
import assert from "node:assert/strict";
import {assertVerifiedTopic,resolvePostingTopics,type VerifiedTopic} from "../src/services/topicRouting.js";

const sample:VerifiedTopic={
 id:1,board:"video_chat",purpose:"profile",chatId:-1002373696859,
 threadId:42,title:"みんなのプロフ",verifiedAt:new Date("2026-10-30T00:00:00Z"),enabled:true,
};
test("verified and matching destination only",()=>{
 assert.equal(assertVerifiedTopic(sample,"video_chat","profile").threadId,42);
 assert.deepEqual(resolvePostingTopics([sample],"video_chat","profile"),[sample]);
 assert.throws(()=>resolvePostingTopics([sample],"area_bbs","profile"),/TOPIC_NOT_VERIFIED/);
 assert.throws(()=>assertVerifiedTopic(sample,"video_chat","room"),/TOPIC_NOT_VERIFIED/);
});
test("message URL numeric suffix cannot be accepted as unverified topic",()=>{
 const bad=[{...sample,threadId:0},{...sample,verifiedAt:new Date("invalid")},
  {...sample,enabled:false},{...sample,chatId:2373696859},
  {...sample,verifiedAt:new Date(Date.now()+1000*3600)}];
 bad.forEach(x=>assert.throws(()=>assertVerifiedTopic(x,"video_chat","profile")));
});
test("ambiguous duplicate destinations never fan out",()=>{
 assert.throws(()=>resolvePostingTopics([sample,{...sample,id:2}],"video_chat","profile"),/DUPLICATE/);
});

test("paid-video Topic shares verified routing without opening any other board",()=>{
 const sale:VerifiedTopic={...sample,purpose:"video_sale",title:"💰稼げる有料動画投稿"};
 assert.equal(assertVerifiedTopic(sale,"video_chat","video_sale").threadId,42);
 assert.deepEqual(resolvePostingTopics([sale],"video_chat","video_sale"),[sale]);
 assert.throws(()=>assertVerifiedTopic({...sale,board:"area_bbs"},"area_bbs","video_sale"),/TOPIC_NOT_VERIFIED/);
 assert.throws(()=>resolvePostingTopics([{...sale,board:"gay_board"}],"gay_board","video_sale"),/TOPIC_NOT_VERIFIED/);
 assert.throws(()=>resolvePostingTopics([{...sale,enabled:false}],"video_chat","video_sale"),/TOPIC_NOT_VERIFIED/);
 assert.throws(()=>resolvePostingTopics([sale,{...sale,id:2}],"video_chat","video_sale"),/DUPLICATE/);
});
