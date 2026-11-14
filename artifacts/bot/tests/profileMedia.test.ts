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

test("album accepts five combined photo/video references but never a sixth",()=>{
 const items=Array.from({length:5},(_,i)=>({type:(i%2?"video":"photo") as "photo"|"video",fileId:"media-"+i,sourceMessageId:i+1}));
 validateProfileMedia(items);
 assert.equal(items.length,5);
 assert.throws(()=>appendProfileMedia(items,{type:"photo",fileId:"sixth",sourceMessageId:6}),/PROFILE_ALBUM_FULL/);
 assert.equal(appendProfileMedia(items,items[1]!).length,5,"duplicate Telegram retry is idempotent");
 assert.throws(()=>validateProfileMedia([...items,{type:"video",fileId:"sixth",sourceMessageId:6}]),/PROFILE_ALBUM_LIMIT_EXCEEDED/);
 const replaced=replaceProfileMedia(numberProfileMedia(items),3,{type:"video",fileId:"replacement",sourceMessageId:7});
 assert.equal(replaced.length,5);
 assert.equal(replaced.find(x=>x.itemId===3)?.fileId,"replacement");
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
