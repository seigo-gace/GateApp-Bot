/** Immutable published profile representation.
 * Do not put the self-PR text in SQL. Only its external object reference
 * is stored here; photos/videos are Telegram file references, never bytes.
 */
import type {SavedProfile} from "./profileRepository.js";
import {readProfilePr} from "./profilePrStorage.js";
import type {ProfileMediaItem} from "./profileMedia.js";
import type {LikeTag} from "./profileLike.js";

export type PublicProfileSnapshot = {
 nickname:string;heightCm:number;weightKg:number;age:number;position:SavedProfile["position"];
 hair?:string|null;body?:string|null;region?:string|null;area?:string|null;
 prRef?:string|null;media?:ProfileMediaItem[];mediaNextId?:number;
 likeTags?:LikeTag[];loveTags?:LikeTag[];
};
export function captureProfileSnapshot(profile:SavedProfile):PublicProfileSnapshot{
 if(!profile.nickname?.trim()||!profile.position||!Number.isSafeInteger(profile.age))
  throw new Error("PUBLIC_PROFILE_SNAPSHOT_INVALID");
 if(profile.pr && !profile.prRef)
  throw new Error("PUBLIC_PROFILE_PR_EXTERNAL_STORAGE_REQUIRED");
 return {
  nickname:profile.nickname,heightCm:profile.heightCm,
  weightKg:profile.weightKg,age:profile.age,position:profile.position,
  hair:profile.hair??null,body:profile.body??null,
  region:profile.region??null,area:profile.area??null,
  prRef:profile.prRef??null,media:profile.media??[],mediaNextId:profile.mediaNextId??1,
  likeTags:profile.likeTags??[],loveTags:profile.loveTags??[],
 };
}
export async function restorePublishedSnapshot(
 ownerId:number,snapshot:PublicProfileSnapshot,revision:number,
):Promise<SavedProfile>{
 if(!Number.isSafeInteger(ownerId)||ownerId<=0||
    !Number.isSafeInteger(revision)||revision<=0)throw Error("PROFILE_SNAPSHOT_INVALID");
 const pr=snapshot.prRef?await readProfilePr(ownerId,snapshot.prRef):null;
 return {...snapshot,pr,username:null,status:"published",revision};
}
