/** ONLINE -> existing Gate Bot -> existing group/topic routing.
 * Only the three verified historical targets are eligible. The backend may
 * issue public links only after a verified runtime target + admin approves.
 * 'Approved' means Gate approval; visiting a Topic also requires membership.
 */
import {randomBytes,createHash} from "node:crypto";
import {pool} from "../db/index.js";
import {ONLINE_HISTORICAL_TARGETS,ONLINE_TOPIC_LEDGER_URL} from "./onlineRoomBoard.js";
import type {OnlineGateLink} from "./onlineRoomBoard.js";
export type OnlineRoomGroup=OnlineGateLink["group"];
export const ONLINE_GROUPS={
 area_bbs:{chatId:-1003847210571,topicUrl:ONLINE_HISTORICAL_TARGETS.area_bbs},
 video_chat:{chatId:-1002373696859,topicUrl:ONLINE_HISTORICAL_TARGETS.video_chat},
 gay_board:{chatId:-1003770334893,topicUrl:ONLINE_HISTORICAL_TARGETS.gay_board},
} as const;
/** Cross-group community-link destination: Area's BBS ONLINE topic (not ROOM B/C/D). */
export const ONLINE_HUB={
 cardKey:"online_hub" as const,
 chatId:-1003847210571,
 topicUrl:ONLINE_TOPIC_LEDGER_URL,
};

const isGroup=(x:string):x is OnlineRoomGroup=>
 Object.prototype.hasOwnProperty.call(ONLINE_GROUPS,x);
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
export const ONLINE_START_PREFIX="online_";

/** Telegram bot username comes from getMe() of the REAL existing GATE Bot. */
export function requireOnlineBotUsername(value:string):string{
 if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value)||!/bot$/i.test(value))
  throw new Error("ONLINE_GATE_IDENTITY_UNVERIFIED");
 return value;
}
export type OnlineRouteKey=OnlineRoomGroup|typeof ONLINE_HUB.cardKey;
export type OnlineRoute={key:OnlineRouteKey;chatId:number;topicUrl:string;targetId:number};

function expectedRoute(cardKey:string):{chatId:number;topicUrl:string}|null{
 if(cardKey===ONLINE_HUB.cardKey)return ONLINE_HUB;
 if(isGroup(cardKey))return ONLINE_GROUPS[cardKey];
 return null;
}

/** Prep command for Composer after verifying Bot Identity and targets.
 * Never rotate an active public token implicitly; revoked links require
 * deliberate migration and existing-publication reconciliation.
 */
export async function issueOnlineGateRoute(
 key:OnlineRoomGroup,username:string,approvedBy:number,
):Promise<OnlineGateLink>{
 if(!isGroup(key)||!Number.isSafeInteger(approvedBy)||approvedBy<=0)
  throw new Error("ONLINE_ISSUE_UNAUTHORIZED");
 const expected=ONLINE_GROUPS[key];
 const bot=requireOnlineBotUsername(username);
 const target=await pool.query(
  `SELECT target_id FROM targets WHERE chat_id=$1 AND target_type='entry_group'`,
  [expected.chatId]);
 if(target.rows.length!==1)throw new Error("ONLINE_GATE_TARGET_NOT_VERIFIED:"+key);
 const existing=await pool.query(
  `SELECT start_url,chat_id,topic_url,enabled FROM online_gate_routes WHERE card_key=$1`,[key]);
 if(existing.rows.length){
  const r=existing.rows[0];
  if(Number(r.chat_id)!==expected.chatId||r.topic_url!==expected.topicUrl||
     !String(r.start_url).startsWith("https://t.me/"+bot+"?start=online_"))
   throw new Error("ONLINE_GATE_EXISTING_ROUTE_MISMATCH");
  return {group:key,gateStartUrl:String(r.start_url),verified:r.enabled===true};
 }
 const token=ONLINE_START_PREFIX+randomBytes(18).toString("base64url");
 const url="https://t.me/"+bot+"?start="+token;
 await pool.query(
  `INSERT INTO online_gate_routes
     (card_key,token_hash,start_url,chat_id,topic_url,verified_by,enabled)
    VALUES($1,$2,$3,$4,$5,$6,FALSE)`,
  [key,hash(token),url,expected.chatId,expected.topicUrl,approvedBy]);
 // Explicit separate approval after actual membership/Topic/START E2E.
 return {group:key,gateStartUrl:url,verified:false};
}
export async function getOnlineGateLinks():Promise<readonly OnlineGateLink[]>{
 const r=await pool.query(
  `SELECT card_key,chat_id,topic_url,start_url,enabled FROM online_gate_routes
   WHERE card_key IN ('area_bbs','video_chat','gay_board')`);
 return (["area_bbs","video_chat","gay_board"] as const).map(key=>{
  const rows=r.rows.filter(x=>x.card_key===key);
  if(rows.length!==1||Number(rows[0].chat_id)!==ONLINE_GROUPS[key].chatId||
     rows[0].topic_url!==ONLINE_GROUPS[key].topicUrl)
   throw new Error("ONLINE_GATE_ROUTE_UNVERIFIED:"+key);
  return {group:key,gateStartUrl:String(rows[0].start_url),verified:rows[0].enabled===true};
 });
}
/** A URL token alone is not permission: verify membership on EVERY return. */
export async function resolveOnlineGatePayload(payload:string):Promise<OnlineRoute|null>{
 if(!/^online_[A-Za-z0-9_-]{24}$/.test(payload))return null;
 const r=await pool.query(
  `SELECT card_key,chat_id,topic_url FROM online_gate_routes
   WHERE token_hash=$1 AND enabled=TRUE`,[hash(payload)]);
 if(r.rows.length!==1)return null;
 const x=r.rows[0];
 const key=String(x.card_key);
 const expected=expectedRoute(key);
 if(!expected||Number(x.chat_id)!==expected.chatId||x.topic_url!==expected.topicUrl)return null;
 const targets=await pool.query(
  `SELECT target_id FROM targets WHERE chat_id=$1 AND target_type='entry_group'`,
  [expected.chatId]);
 if(targets.rows.length!==1)return null;
 return {key:key as OnlineRouteKey,chatId:expected.chatId,topicUrl:expected.topicUrl,
  targetId:Number(targets.rows[0].target_id)};
}
export async function rememberOnlineGateDestination(userId:number,route:OnlineRoute):Promise<void>{
 if(!Number.isSafeInteger(userId)||userId<=0)throw new Error("ONLINE_USER_ID_INVALID");
 const expected=expectedRoute(route.key);
 if(!expected||expected.chatId!==route.chatId||expected.topicUrl!==route.topicUrl)
  throw new Error("ONLINE_ROUTE_DESTINATION_MISMATCH");
 await pool.query(
  `INSERT INTO online_gate_sessions(tg_user_id,card_key,target_id)
   VALUES($1,$2,$3)
   ON CONFLICT(tg_user_id) DO UPDATE SET card_key=EXCLUDED.card_key,
    target_id=EXCLUDED.target_id,updated_at=NOW()`,
  [userId,route.key,route.targetId]);
}
export async function recallOnlineGateDestination(userId:number):Promise<OnlineRoute|null>{
 const s=await pool.query(
  `SELECT s.card_key,s.target_id,r.chat_id,r.topic_url,r.enabled
   FROM online_gate_sessions s JOIN online_gate_routes r ON r.card_key=s.card_key
   WHERE s.tg_user_id=$1`,[userId]);
 if(s.rows.length!==1||s.rows[0].enabled!==true)return null;
 const x=s.rows[0];
 const key=String(x.card_key);
 const expected=expectedRoute(key);
 if(!expected||Number(x.chat_id)!==expected.chatId||x.topic_url!==expected.topicUrl)return null;
 const t=await pool.query(
  `SELECT target_id FROM targets WHERE chat_id=$1 AND target_type='entry_group'`,[expected.chatId]);
 if(t.rows.length!==1||Number(t.rows[0].target_id)!==Number(x.target_id))
  return null;
 return {key:key as OnlineRouteKey,targetId:Number(x.target_id),chatId:expected.chatId,topicUrl:expected.topicUrl};
}
