import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pool} from "../src/db/index.js";
import {putDraft,getDraft,getProfile,savePrivateDraft} from "../src/services/profileRepository.js";

const id=900000000093;
const prior=process.env.PROFILE_PR_STORAGE_DIR;
const root=await mkdtemp(join(tmpdir(),"gace-profile-iii-"));
try{
 process.env.PROFILE_PR_STORAGE_DIR=root;
 await pool.query("DELETE FROM profile_drafts WHERE owner_user_id=$1",[id]);
 await pool.query("DELETE FROM profiles WHERE owner_user_id=$1",[id]);
 const base={nickname:"テスト",heightCm:175,weightKg:80,age:40,position:"タチ" as const,
   pr:"DB外で保持する自己PR",mediaNextId:3,media:[
    {type:"photo" as const,itemId:1,fileId:"photo-ref-1",sourceMessageId:501},
    {type:"video" as const,itemId:2,fileId:"video-ref-2",sourceMessageId:502},
   ]};
 const draft=await putDraft(id,"preview",base);
 assert.equal(draft.data.pr,base.pr);
 assert.match(draft.data.prRef??"",/^[a-f0-9]{64}$/);
 const sqlDraft=await pool.query("SELECT data FROM profile_drafts WHERE owner_user_id=$1",[id]);
 assert.equal(sqlDraft.rows[0].data.pr,undefined,"PR body must not be in JSONB");
 assert.equal(sqlDraft.rows[0].data.prRef,draft.data.prRef);
 const saved=await savePrivateDraft(id,draft.revision,"test_user_123");
 assert.equal(saved.pr,base.pr);
 const row=await pool.query("SELECT pr,pr_ref,media_next_id FROM profiles WHERE owner_user_id=$1",[id]);
 assert.equal(row.rows[0].pr,null);
 assert.equal(row.rows[0].pr_ref,draft.data.prRef);
 assert.equal(Number(row.rows[0].media_next_id),3);
 const loaded=await getProfile(id);
 assert.equal(loaded?.pr,base.pr);
 assert.deepEqual(loaded?.media?.map(x=>[x.itemId,x.sourceMessageId,x.fileId]),
  [[1,501,"photo-ref-1"],[2,502,"video-ref-2"]]);
 assert.equal(loaded?.mediaNextId,3);
 // Upgraded legacy profiles can have numbered media and a default counter=1.
 // Reload must not recycle those already assigned item numbers.
 await pool.query("UPDATE profiles SET media_next_id=1 WHERE owner_user_id=$1",[id]);
 assert.equal((await getProfile(id))?.mediaNextId,3);
 const next=await putDraft(id,"preview",{...base,mediaNextId:4,media:[
  {...base.media[1]!},
  {type:"photo",itemId:3,fileId:"photo-ref-3",sourceMessageId:503},
 ]});
 const updated=await savePrivateDraft(id,next.revision,"test_user_123");
 assert.equal(updated.mediaNextId,4);
 assert.deepEqual((await getProfile(id))?.media?.map(x=>x.itemId),[2,3]);
 const deleted=await putDraft(id,"preview",{...base,mediaNextId:4,media:[],pr:null,prRef:null});
 await savePrivateDraft(id,deleted.revision,"test_user_123");
 const final=await getProfile(id);
 assert.equal(final?.pr,null);
 assert.equal(final?.prRef,null);
 assert.deepEqual(final?.media,[]);
 assert.equal(final?.mediaNextId,4);
 const sql=await pool.query("SELECT pr,pr_ref FROM profiles WHERE owner_user_id=$1",[id]);
 assert.equal(sql.rows[0].pr,null);
 assert.equal(sql.rows[0].pr_ref,null);
 process.stdout.write("PROFILE_III_SQL_OBJECT_ROUNDTRIP=PASS\n");
}finally{
 await pool.query("DELETE FROM profile_drafts WHERE owner_user_id=$1",[id]);
 await pool.query("DELETE FROM profiles WHERE owner_user_id=$1",[id]);
 if(prior===undefined)delete process.env.PROFILE_PR_STORAGE_DIR;
 else process.env.PROFILE_PR_STORAGE_DIR=prior;
 await rm(root,{recursive:true,force:true});
 await pool.end();
}
