/** Public recruitment panels are bound to the published recruitment, never
 * to the owner's mutable/private profile. Reuse the profile panel layout. */
import {randomBytes} from "node:crypto";
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {profilePanelRows,VIEW_TOKEN_PATTERN} from "./profilePublicView.js";
import type {TransportButton} from "./telegramDispatcher.js";
import {isProfilePosition,type ProfileBasicDraft} from "./profileCore.js";
import {validLikeTags} from "./profileLike.js";
import {validateRecruitmentExtras,type RecruitmentInput} from "./recruitmentCompose.js";
import type {SavedProfile} from "./profileRepository.js";

export const RECRUITMENT_UI_VERSION=1;
const positive=(n:number)=>Number.isSafeInteger(n)&&n>0;
export function recruitmentViewRows(token:string,username:string|null):TransportButton[][]{
 return profilePanelRows(token,username).map(row=>row.map(b=>({
  ...b,...(b.callback_data?{callback_data:b.callback_data.replace(/^pfv:/,"rv:")}:{})
 })));
}
export async function verifiedRecruitmentUsername(telegram:Pick<Telegram,"getChat">,owner:number):Promise<string|null>{
 const chat=await telegram.getChat(owner);
 if(Number(chat.id)!==owner)throw Error("RECRUITMENT_OWNER_ID_MISMATCH");
 const u="username" in chat?chat.username:null;
 return typeof u==="string"&&/^[A-Za-z0-9_]{5,32}$/.test(u)?u:null;
}
export async function ensureRecruitmentViewToken(owner:number,sourceId:number):Promise<string>{
 if(!positive(owner)||!positive(sourceId))throw Error("RECRUITMENT_SOURCE_INVALID");
 const candidate=randomBytes(24).toString("base64url");
 const r=await pool.query(
  "UPDATE announcement_posts SET conditions=jsonb_set(conditions,'{viewToken}',to_jsonb(COALESCE(conditions->>'viewToken',$3::text)),true)"+
  " WHERE owner_user_id=$1 AND announcement_id=$2 AND kind='recruitment' AND status IN ('draft','publishing','published')"+
  " RETURNING conditions->>'viewToken' AS token",[owner,sourceId,candidate]);
 const token=r.rows[0]?.token;
 if(r.rows.length!==1||typeof token!=="string"||!VIEW_TOKEN_PATTERN.test(token))throw Error("RECRUITMENT_VIEW_TOKEN_INVALID");
 return token;
}
export function recruitmentIdentitySnapshot(value:unknown):ProfileBasicDraft{
 if(!value||typeof value!=="object")throw Error("RECRUITMENT_PUBLIC_IDENTITY_MISSING");
 const p=value as Record<string,unknown>;
 if(typeof p.nickname!=="string"||!p.nickname.trim()||
    ![p.heightCm,p.weightKg,p.age].every(v=>typeof v==="number"&&positive(v))||
    typeof p.position!=="string"||!isProfilePosition(p.position))
  throw Error("RECRUITMENT_PUBLIC_IDENTITY_INVALID");
 return {nickname:p.nickname,heightCm:Number(p.heightCm),weightKg:Number(p.weightKg),age:Number(p.age),position:p.position};
}
export function recruitmentInputFromRow(x:any):RecruitmentInput{
 const c=x.conditions??{};
 const linked=c.inputMode==="linked";
 const input:RecruitmentInput={
  mode:linked?"linked":"manual",title:String(c.title??""),body:String(x.text??""),
  ...(linked?{}:{nickname:String(c.nickname??""),heightCm:Number(c.heightCm),
   weightKg:Number(c.weightKg),age:Number(c.age),position:String(c.position??"")}),
  purposeCodes:Array.isArray(x.purpose_codes)?x.purpose_codes:[],
  placeCodes:Array.isArray(x.place_codes)?x.place_codes:[],
  likeTags:validLikeTags(Array.isArray(c.likeTags)?c.likeTags:[]),
  loveTags:validLikeTags(Array.isArray(c.loveTags)?c.loveTags:[]),
  hair:c.hair??null,appearanceBody:c.appearanceBody??null,region:c.region??null,area:c.area??null,
  media:Array.isArray(c.media)?c.media:[],mediaNextId:Number(c.mediaNextId??1),
 };
 validateRecruitmentExtras(input);
 return input;
}
export function recruitmentPanelProfile(input:RecruitmentInput,basic:ProfileBasicDraft,revision:number):SavedProfile{
 if(!basic.position||!isProfilePosition(basic.position))throw Error("RECRUITMENT_PUBLIC_IDENTITY_INVALID");
 return {...basic,position:basic.position,revision,status:"published",username:null,
  title:input.title,hair:input.hair,body:input.appearanceBody,region:input.region,area:input.area,
  likeTags:input.likeTags,loveTags:input.loveTags,purposeCodes:input.purposeCodes,placeCodes:input.placeCodes,
  media:input.media,pr:input.body};
}
export async function resolveRecruitmentPanel(token:string,chatId:number,messageId?:number){
 if(!VIEW_TOKEN_PATTERN.test(token)||!Number.isSafeInteger(chatId)||chatId>=0||
   (messageId!==undefined&&!positive(messageId)))return null;
 const r=await pool.query(
  `SELECT a.owner_user_id,a.revision,a.text,a.conditions,a.profile_snapshot,a.purpose_codes,a.place_codes
   FROM announcement_posts a
   JOIN posting_deliveries d ON d.source_type='announcement' AND d.source_id=a.announcement_id::text
    AND d.owner_user_id=a.owner_user_id AND d.status='sent' AND d.telegram_message_id IS NOT NULL
   JOIN posting_topics t ON t.topic_id=d.posting_topic_id AND t.purpose='announcement'
    AND t.enabled=TRUE AND t.verified_at IS NOT NULL AND t.verified_by IS NOT NULL
   WHERE a.kind='recruitment' AND a.status='published' AND a.conditions->>'viewToken'=$1
    AND a.conditions->>'recruitmentUiVersion'=$4 AND t.chat_id=$2
    AND ($3::bigint IS NULL OR d.telegram_message_id=$3::bigint)`,
  [token,chatId,messageId??null,String(RECRUITMENT_UI_VERSION)]);
 if(r.rows.length!==1)return null;
 const x=r.rows[0];
 const input=recruitmentInputFromRow(x);
 const basic=recruitmentIdentitySnapshot(input.mode==="linked"?x.profile_snapshot:input);
 return {ownerId:Number(x.owner_user_id),input,basic,profile:recruitmentPanelProfile(input,basic,Number(x.revision))};
}
