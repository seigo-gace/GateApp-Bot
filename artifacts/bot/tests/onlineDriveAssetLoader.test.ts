import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ONLINE_DRIVE_ASSET_PROOFS,onlineDriveAssetLoader} from "../src/services/onlineDriveAssetLoader.js";
import {ONLINE_CARD_ORDER,ONLINE_MEDIA} from "../src/services/onlineRoomBoard.js";

test("all four Drive-backed ONLINE images have pinned byte sizes and immutable hashes",()=>{
 assert.deepEqual(Object.keys(ONLINE_DRIVE_ASSET_PROOFS),ONLINE_CARD_ORDER);
 for(const key of ONLINE_CARD_ORDER){
  const proof=ONLINE_DRIVE_ASSET_PROOFS[key];
  assert.match(proof.sha256,/^[a-f0-9]{64}$/);
  assert.ok(proof.size>100000);
  assert.ok(ONLINE_MEDIA[key].driveFileId.length>15);
  assert.equal(proof.mimeType,key==="area_bbs"?"image/png":"image/jpeg");
 }
});
test("unavailable or replaced Drive images fail closed instead of publishing",async()=>{
 const root=await mkdtemp(join(tmpdir(),"online-drive-probe-"));
 try{
  const loader=onlineDriveAssetLoader(root);
  await assert.rejects(loader(ONLINE_MEDIA.intro.driveFileId),/ENOENT/);
  await writeFile(join(root,ONLINE_MEDIA.intro.filename),Buffer.from("replacement"));
  await assert.rejects(loader(ONLINE_MEDIA.intro.driveFileId),/ONLINE_MEDIA_SIZE_MISMATCH/);
  await assert.rejects(loader("unregistered-drive-file"),/ONLINE_DRIVE_FILE_UNRECOGNIZED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("asset loader must use an absolute existing asset root",()=>{
 assert.throws(()=>onlineDriveAssetLoader("relative-path"),/ONLINE_ASSET_ROOT_NOT_ABSOLUTE/);
});
