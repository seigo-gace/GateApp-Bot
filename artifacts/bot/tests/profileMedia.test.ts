import test from "node:test";
import assert from "node:assert/strict";
import {appendProfileMedia,validateProfileMedia,numberProfileMedia,replaceProfileMedia,deleteProfileMedia} from "../src/services/profileMedia.js";
test("Telegram media references only",()=>{
 const a=appendProfileMedia([],{type:"photo",fileId:"photo-id",sourceMessageId:100});
 const b=appendProfileMedia(a,{type:"video",fileId:"video-id",sourceMessageId:101});
 validateProfileMedia(b);
 assert.equal(b.length,2);
 assert.deepEqual(b.map(x=>x.fileId),["photo-id","video-id"]);
 assert.equal(appendProfileMedia(b,b[0]!).length,2);
});

test("no unapproved arbitrary cap on media references",()=>{
 const items=Array.from({length:101},(_,i)=>({type:"photo" as const,fileId:"media-"+i,sourceMessageId:i+1}));
 validateProfileMedia(items);
 assert.equal(items.length,101);
});

test("③ media item numbers remain stable through replacement and deletion",()=>{
 const old=numberProfileMedia([
  {type:"photo",fileId:"a",sourceMessageId:500},
  {type:"video",fileId:"b",sourceMessageId:501},
  {type:"photo",fileId:"c",sourceMessageId:502},
 ]);
 assert.deepEqual(old.map(x=>x.itemId),[1,2,3]);
 const replaced=replaceProfileMedia(old,2,{type:"video",fileId:"new",sourceMessageId:503});
 assert.deepEqual(replaced.map(x=>[x.itemId,x.fileId]),[[1,"a"],[2,"new"],[3,"c"]]);
 const deleted=deleteProfileMedia(replaced,1);
 assert.deepEqual(deleted.map(x=>x.itemId),[2,3]);
 assert.throws(()=>deleteProfileMedia(deleted,1),/NOT_FOUND/);
 assert.throws(()=>replaceProfileMedia(deleted,1,{type:"photo",fileId:"x",sourceMessageId:504}),/NOT_FOUND/);
 assert.throws(()=>replaceProfileMedia(deleted,2,{type:"photo",fileId:"x",sourceMessageId:502}),/DUPLICATE/);
 validateProfileMedia(deleted);
});
