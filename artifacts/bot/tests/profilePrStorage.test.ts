import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {storeProfilePr,readProfilePr} from "../src/services/profilePrStorage.js";

test("PR text is stored atomically outside DB and recovered from immutable reference",async()=>{
 const root=await mkdtemp(join(tmpdir(),"gace-profile-pr-"));
 const before=process.env.PROFILE_PR_STORAGE_DIR;
 try{
   process.env.PROFILE_PR_STORAGE_DIR=root;
   const ref=await storeProfilePr(12345,"私の自己紹介です\nよろしくお願いします");
   assert.match(ref,/^[a-f0-9]{64}$/);
   assert.equal(await readProfilePr(12345,ref),"私の自己紹介です\nよろしくお願いします");
   assert.equal(await storeProfilePr(12345,"私の自己紹介です\nよろしくお願いします"),ref);
   const next=await storeProfilePr(12345,"差し替えました");
   assert.notEqual(next,ref);
   assert.equal(await readProfilePr(12345,next),"差し替えました");
   assert.equal(await readProfilePr(12345,ref),"私の自己紹介です\nよろしくお願いします");
   await assert.rejects(()=>readProfilePr(23456,ref));
   await assert.rejects(()=>readProfilePr(12345,"../../secret"));
   assert.equal(await readFile(join(root,"12345",next+".txt"),"utf8"),"差し替えました");
 }finally{
  if(before===undefined)delete process.env.PROFILE_PR_STORAGE_DIR;
  else process.env.PROFILE_PR_STORAGE_DIR=before;
  await rm(root,{recursive:true,force:true});
 }
});
test("when durable PR storage is not configured, do not silently keep PR in SQL",async()=>{
 const previous=process.env.PROFILE_PR_STORAGE_DIR;
 try{
  delete process.env.PROFILE_PR_STORAGE_DIR;
  await assert.rejects(()=>storeProfilePr(123,"自己紹介"),/NOT_CONFIGURED/);
 }finally{
  if(previous!==undefined)process.env.PROFILE_PR_STORAGE_DIR=previous;
 }
});
