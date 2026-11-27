import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pool} from "../src/db/index.js";
import {runMigrations} from "../src/db/migrate.js";
import {putDraft,getDraft,getProfile,savePrivateDraft} from "../src/services/profileRepository.js";
import {startCompactProfileEditor,returnFromCompactAppearance} from "../src/bot/profileCompactHandlers.js";

const owner=900000000098;
const previous=process.env.PROFILE_PR_STORAGE_DIR;
const root=await mkdtemp(join(tmpdir(),"profile-album-check-"));
try{
 process.env.PROFILE_PR_STORAGE_DIR=root;
 await runMigrations();
 await pool.query("DELETE FROM profile_drafts WHERE owner_user_id=$1",[owner]);
 await pool.query("DELETE FROM profiles WHERE owner_user_id=$1",[owner]);
 const media=Array.from({length:5},(_,i)=>({
  type:(i%2?"video":"photo") as "video"|"photo",
  itemId:i+1,fileId:"album-"+i,sourceMessageId:1000+i,
 }));
 const input={
  title:"自己紹介",nickname:"テスト",heightCm:175,weightKg:80,age:40,
  position:"タチ" as const,
  purposeCodes:["サシ"],placeCodes:["場所あり","足あり"],
  likeTags:[{category:"パーツ",tag:"乳首"}],
  loveTags:[{category:"パーツ",tag:"乳首"}],
  media,mediaNextId:6,pr:"プロフィールPR本文",
 };
 const created=await putDraft(owner,"compact",input);
 const saved=await savePrivateDraft(owner,created.revision,"test_user_998");
 assert.equal(saved.title,"自己紹介");
 const loaded=await getProfile(owner);
 assert.deepEqual(loaded?.purposeCodes,["サシ"]);
 assert.deepEqual(loaded?.placeCodes,["場所あり","足あり"]);
 assert.deepEqual(loaded?.media?.map(m=>[m.type,m.fileId]),media.map(m=>[m.type,m.fileId]));
 assert.equal(loaded?.pr,"プロフィールPR本文");
 assert.equal(loaded?.likeTags?.length,1);
 assert.equal(loaded?.loveTags?.length,1);
 const legacy=await putDraft(owner,"appearance",{
  nickname:input.nickname,heightCm:input.heightCm,weightKg:input.weightKg,
  age:input.age,position:input.position,
  media:loaded!.media,mediaNextId:loaded!.mediaNextId,likeTags:loaded!.likeTags,loveTags:loaded!.loveTags,
  hair:"短髪",pr:loaded!.pr,prRef:loaded!.prRef
 });
 await savePrivateDraft(owner,legacy.revision,"test_user_998");
 const after=await getProfile(owner);
 assert.equal(after?.title,"自己紹介","legacy editor may not erase recruitment title");
 assert.deepEqual(after?.purposeCodes,["サシ"]);
 assert.deepEqual(after?.placeCodes,["場所あり","足あり"]);
 assert.equal(after?.media?.length,5);
 // Clicking a newer posting menu must edit *that* message, not an older
 // profile wizard screen held in the existing draft.
 const prior=await putDraft(owner,"compact",{
  ...input,screenMessageId:1200
 });
 const edits:unknown[][]=[];
 await startCompactProfileEditor({
  chat:{type:"private"},from:{id:owner,username:"test_user_998"},
  callbackQuery:{message:{message_id:1300}},
  telegram:{editMessageText:async(...args:unknown[])=>{edits.push(args);}},
  reply:async()=>{throw Error("UNEXPECTED_PROFILE_FALLBACK_REPLY");}
 } as any);
 const refreshed=await getDraft(owner);
 assert.equal(refreshed?.data.screenMessageId,1300);
 assert.equal(edits.length,1);
 assert.equal(edits[0]?.[1],1300,"profile must open on the tapped menu message");
 assert.ok((refreshed?.revision??0)>prior.revision);
 // Exercise the actual shared appearance exit against PostgreSQL.
 const appearance=await putDraft(owner,"appearance",{
  ...refreshed!.data,compactOrigin:"profile",hair:"短髪",age:41,pr:"変更した自己PR"
 },refreshed!.revision);
 const answers:string[]=[];
 const editCtx={
  chat:{type:"private"},from:{id:owner,username:"test_user_998"},
  callbackQuery:{message:{message_id:1300}},
  telegram:{editMessageText:async(...args:unknown[])=>{edits.push(args);}},
  answerCbQuery:async(message?:string)=>{answers.push(message??"");},
  reply:async()=>{throw Error("UNEXPECTED_PROFILE_FALLBACK_REPLY");}
 };
 await returnFromCompactAppearance(editCtx as any,appearance,true);
 const restored=await getDraft(owner);
 assert.equal(restored?.step,"compact");
 assert.equal(restored?.revision,appearance.revision+1);
 assert.equal(restored?.data.screenMessageId,1300);
 assert.equal(restored?.data.compactOrigin,"profile");
 assert.equal(restored?.data.media?.length,5);
 assert.equal(restored?.data.pr,"変更した自己PR");
 assert.equal((await getProfile(owner))?.age,41);
 assert.equal((await getProfile(owner))?.hair,"短髪");
 assert.equal(edits.at(-1)?.[1],1300);
 await assert.rejects(savePrivateDraft(owner,appearance.revision,"test_user_998",true),/PROFILE_DRAFT_STALE/);
 console.log("PROFILE_ATOMIC_SECTION_SAVE_AND_RESUME=PASS");
 console.log("PROFILE_MENU_CALLBACK_SCREEN_REBIND=PASS");
 console.log("PROFILE_SHARED_ALBUM_SQL_ROUNDTRIP=PASS");
}finally{
 try{
  await pool.query("DELETE FROM profile_drafts WHERE owner_user_id=$1",[owner]);
  await pool.query("DELETE FROM profiles WHERE owner_user_id=$1",[owner]);
 }finally{
  if(previous===undefined)delete process.env.PROFILE_PR_STORAGE_DIR;
  else process.env.PROFILE_PR_STORAGE_DIR=previous;
  await rm(root,{recursive:true,force:true});
  await pool.end();
 }
}
