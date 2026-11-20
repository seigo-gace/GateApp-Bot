import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pool} from "../src/db/index.js";
import {readProfilePr} from "../src/services/profilePrStorage.js";
import {migrateLegacyProfilePr} from "../scripts/migrateLegacyProfilePr.js";

const userId=900000000003;
const backup=process.env.PROFILE_PR_STORAGE_DIR;
const root=await mkdtemp(join(tmpdir(),"profile-legacy-migrate-"));
try {
 await pool.query(`INSERT INTO profiles(owner_user_id,nickname,height_cm,weight_kg,age,position,status,pr)
  VALUES($1,'legacy',175,80,40,'タチ','private','元の自己PR')
  ON CONFLICT(owner_user_id) DO UPDATE SET pr='元の自己PR',pr_ref=NULL`,[userId]);
 delete process.env.PROFILE_PR_STORAGE_DIR;
 const dry=await migrateLegacyProfilePr(true);
 assert.equal(dry.mode,"dry-run");
 assert.ok(dry.scanned>=1);
 const before=await pool.query("SELECT pr,pr_ref FROM profiles WHERE owner_user_id=$1",[userId]);
 assert.equal(before.rows[0].pr,"元の自己PR");
 assert.equal(before.rows[0].pr_ref,null);
 await assert.rejects(()=>migrateLegacyProfilePr(false),/NOT_CONFIGURED/);
 const still=await pool.query("SELECT pr,pr_ref FROM profiles WHERE owner_user_id=$1",[userId]);
 assert.equal(still.rows[0].pr,"元の自己PR");
 process.env.PROFILE_PR_STORAGE_DIR=root;
 const result=await migrateLegacyProfilePr(false);
 assert.ok(result.migrated>=1);
 const after=await pool.query("SELECT pr,pr_ref FROM profiles WHERE owner_user_id=$1",[userId]);
 assert.equal(after.rows[0].pr,null);
 assert.match(after.rows[0].pr_ref,/^[a-f0-9]{64}$/);
 assert.equal(await readProfilePr(userId,after.rows[0].pr_ref),"元の自己PR");
 const again=await migrateLegacyProfilePr(false);
 assert.equal(again.migrated,0);
 process.stdout.write("PROFILE_LEGACY_PR_MIGRATION=PASS\n");
}finally {
 await pool.query("DELETE FROM profiles WHERE owner_user_id=$1",[userId]);
 if(backup===undefined)delete process.env.PROFILE_PR_STORAGE_DIR;
 else process.env.PROFILE_PR_STORAGE_DIR=backup;
 await rm(root,{recursive:true,force:true});
 await pool.end();
}
