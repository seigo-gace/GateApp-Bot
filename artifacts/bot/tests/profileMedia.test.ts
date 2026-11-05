import test from "node:test";
import assert from "node:assert/strict";
import {appendProfileMedia,validateProfileMedia} from "../src/services/profileMedia.js";
test("Telegram media references only",()=>{
 const a=appendProfileMedia([],{type:"photo",fileId:"photo-id",sourceMessageId:100});
 const b=appendProfileMedia(a,{type:"video",fileId:"video-id",sourceMessageId:101});
 validateProfileMedia(b);
 assert.equal(b.length,2);
 assert.deepEqual(b.map(x=>x.fileId),["photo-id","video-id"]);
 assert.equal(appendProfileMedia(b,b[0]!).length,2);
});
