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
 // Profile tags are a distinct purpose-scoped relation; no public posts are written.
 const tags=[{category:"パーツ",tag:"乳首"},{category:"性感帯",tag:"乳首"}];
 const legacyCategory="旧データ互換",legacyTag="旧タグ保持";
 await pool.query("INSERT INTO profile_tag_catalog(category,tag,ordinal) VALUES($1,$2,1) ON CONFLICT DO NOTHING",
  [legacyCategory,legacyTag]);
 await pool.query("INSERT INTO profile_tags(owner_user_id,purpose,category,tag) VALUES($1,'like',$2,$3) ON CONFLICT DO NOTHING",
  [id,legacyCategory,legacyTag]);
 const withTags=await putDraft(id,"like-items",{...base,likeTags:tags,loveTags:[{category:"パーツ",tag:"乳首"}]});
 await savePrivateDraft(id,withTags.revision,"test_user_123");
 const savedTags=await getProfile(id);
 assert.deepEqual(savedTags?.likeTags,tags);
 assert.deepEqual(savedTags?.loveTags,[{category:"パーツ",tag:"乳首"}]);
 const changed=await putDraft(id,"like-categories",{...base,likeTags:[tags[0]!],loveTags:savedTags?.loveTags});
 await savePrivateDraft(id,changed.revision,"test_user_123");
 const all=await pool.query("SELECT purpose,category,tag FROM profile_tags WHERE owner_user_id=$1",[id]);
 assert.ok(all.rows.some(x=>x.purpose==="like"&&x.category===legacyCategory&&x.tag===legacyTag));
 assert.ok(all.rows.some(x=>x.purpose==="love"&&x.category==="パーツ"&&x.tag==="乳首"));
 assert.ok(!all.rows.some(x=>x.purpose==="like"&&x.category==="性感帯"&&x.tag==="乳首"));
 assert.deepEqual((await getProfile(id))?.likeTags,[tags[0]!]);
 process.stdout.write("PROFILE_LIKE_LOVE_SQL_ROUNDTRIP=PASS\\n");
 process.stdout.write("PROFILE_III_SQL_OBJECT_ROUNDTRIP=PASS\n");
}finally{
 await pool.query("DELETE FROM profile_drafts WHERE owner_user_id=$1",[id]);
 await pool.query("DELETE FROM profiles WHERE owner_user_id=$1",[id]);
 if(prior===undefined)delete process.env.PROFILE_PR_STORAGE_DIR;
 else process.env.PROFILE_PR_STORAGE_DIR=prior;
 await rm(root,{recursive:true,force:true});
 await pool.end();
}
