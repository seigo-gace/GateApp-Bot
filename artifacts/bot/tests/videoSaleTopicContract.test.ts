import test from "node:test";
import assert from "node:assert/strict";
import { publishPost } from "../src/services/publishService.js";

test("shared text-post publisher rejects video_sale before any Telegram or DB effects",async()=>{
 let calls=0;
 const telegram={getChat:async()=>{calls++;throw Error("should not call Telegram");}};
 const req={sourceType:"video_sale",sourceId:"sale001",ownerId:123,
   revision:1,topicId:1,text:"paid video",approved:true};
 await assert.rejects(()=>publishPost(telegram as never,req as never),
   /VIDEO_SALE_REQUIRES_VERIFIED_PAID_MEDIA_PUBLISHER/);
 assert.equal(calls,0);
});
test("video_sale cannot be smuggled into destinationPurpose of ordinary text post",async()=>{
 let calls=0;
 const telegram={getChat:async()=>{calls++;throw Error("should not call Telegram");}};
 const req={sourceType:"link",destinationPurpose:"video_sale",sourceId:"item001",
   ownerId:123,revision:1,topicId:1,text:"not a paid media message",approved:true};
 await assert.rejects(()=>publishPost(telegram as never,req as never),
   /VIDEO_SALE_REQUIRES_VERIFIED_PAID_MEDIA_PUBLISHER/);
 assert.equal(calls,0);
});
