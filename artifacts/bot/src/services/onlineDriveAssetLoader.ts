/** Original 1080x1080 ONLINE images fetched from the connected Drive,
 * byte-verified on 2026-11-08 (JST). Filenames and checksums are exact.
 * No image transform, resize, recompression or remote URL guessing.
 */
import {createHash} from "node:crypto";
import {readFile, lstat, realpath} from "node:fs/promises";
import {join,resolve,sep} from "node:path";
import type {OnlineMediaAsset} from "./onlineRoomPublisher.js";
import {ONLINE_MEDIA,ONLINE_CARD_ORDER} from "./onlineRoomBoard.js";

export const ONLINE_DRIVE_ASSET_PROOFS={
 intro:{size:543343,sha256:"01c2917d4d46397641b4a64b7263ea3c264dfb54c6278074abbefb9ea44c3f6b",mimeType:"image/jpeg" as const},
 area_bbs:{size:1109867,sha256:"8220e50b1a295c789b056ef48a49ac6a36826e0ca624d5fa5ad7513ad54e35b5",mimeType:"image/png" as const},
 video_chat:{size:387687,sha256:"47f7a8345e3e8e082276a447f75390b0fd47f622c7be857832d6e05d1052c55e",mimeType:"image/jpeg" as const},
 gay_board:{size:475218,sha256:"bffea7ac0137ddf2abf8166a62472f02907f657c9700f1cabbbc3c2a502364f9",mimeType:"image/jpeg" as const},
} as const;

/** ONLINE_ROOM_ASSET_DIR points to a read-only runtime-mount directory
 * containing precisely the four originals downloaded from connected Drive.
 * This adapter never calls Drive itself, mutates images, or publishes.
 */
export function onlineDriveAssetLoader(root:string){
 if(!root||!root.trim()||!root.startsWith("/"))
  throw new Error("ONLINE_ASSET_ROOT_NOT_ABSOLUTE");
 const dir=resolve(root);
 return async (driveFileId:string):Promise<OnlineMediaAsset>=>{
  const key=ONLINE_CARD_ORDER.find(k=>ONLINE_MEDIA[k].driveFileId===driveFileId);
  if(!key)throw new Error("ONLINE_DRIVE_FILE_UNRECOGNIZED");
  const spec=ONLINE_DRIVE_ASSET_PROOFS[key];
  const filename=ONLINE_MEDIA[key].filename;
  const file=join(dir,filename);
  const rootReal=await realpath(dir);
  const fileStat=await lstat(file);
  if(!fileStat.isFile()||fileStat.isSymbolicLink())
   throw new Error("ONLINE_MEDIA_NOT_REGULAR_FILE:"+key);
  const fileReal=await realpath(file);
  if(!fileReal.startsWith(rootReal+sep))
   throw new Error("ONLINE_MEDIA_OUTSIDE_ROOT:"+key);
  if(fileStat.size!==spec.size)
   throw new Error("ONLINE_MEDIA_SIZE_MISMATCH:"+key);
  const bytes=await readFile(file);
  const digest=createHash("sha256").update(bytes).digest("hex");
  if(digest!==spec.sha256)throw new Error("ONLINE_MEDIA_CHECKSUM_MISMATCH:"+key);
  return {bytes,mimeType:spec.mimeType,width:1080,height:1080,verifiedDriveFileId:driveFileId};
 };
}
