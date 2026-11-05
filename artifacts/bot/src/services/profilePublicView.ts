/** Public profile viewer links use an opaque, publication-scoped token.
 * They reveal nothing while the source is private or reconciliation is pending.
 * Stable per (owner, revision, topic), so a Telegram retry cannot rotate URLs.
 */
import {randomBytes} from "node:crypto";
import {pool} from "../db/index.js";
import type {SavedProfile} from "./profileRepository.js";
import {restorePublishedSnapshot,type PublicProfileSnapshot} from "./profilePublicSnapshot.js";

export const VIEW_TOKEN_PATTERN=/^[A-Za-z0-9_-]{32}$/;
export type ViewerPurpose="profile"|"media"|"tags";
const prefixes:Record<ViewerPurpose,string>={profile:"pv",media:"pm",tags:"pt"};
export function profileViewerUrl(purpose:ViewerPurpose,token:string):string{
 if(!VIEW_TOKEN_PATTERN.test(token))throw new Error("PROFILE_VIEW_TOKEN_INVALID");
 return "https://t.me/GayBBS_bot?start="+prefixes[purpose]+"_"+token;
}
function assertId(value:number):void{
 if(!Number.isSafeInteger(value)||value<=0)throw new Error("PROFILE_VIEW_ID_INVALID");
}
export async function makeProfileViewerButtons(
 ownerId:number,revision:number,topicId:number,
):Promise<{text:string;url:string}[][]>{
 assertId(ownerId);assertId(revision);assertId(topicId);
 // New token created only on first (owner,revision,topic). A repeated
 // publish operation receives exactly the same URLs.
 const candidate=randomBytes(24).toString("base64url");
 const row=await pool.query(
  `INSERT INTO profile_view_links(owner_user_id,profile_revision,topic_id,token)
   SELECT $1,$2,$3,$4
   WHERE EXISTS(
     SELECT 1 FROM profiles WHERE owner_user_id=$1
       AND revision=$2 AND status IN ('private','published')
   )
   ON CONFLICT(owner_user_id,profile_revision,topic_id)
   DO UPDATE SET token=profile_view_links.token
   RETURNING token,enabled`,
  [ownerId,revision,topicId,candidate]);
 if(row.rows.length!==1||row.rows[0].enabled!==true)
  throw Error("PROFILE_VIEW_SOURCE_NOT_ELIGIBLE");
 const token=String(row.rows[0].token);
 return [[
  {text:"🪪プロフ",url:profileViewerUrl("profile",token)},
  {text:"画像/動画",url:profileViewerUrl("media",token)},
  {text:"#Love & Like",url:profileViewerUrl("tags",token)},
 ]];
}
export function parseProfileViewerPayload(payload:string):
 {purpose:ViewerPurpose;token:string}|null{
 const match=/^(pv|pm|pt)_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match)return null;
 const purpose=Object.keys(prefixes).find(
  p=>prefixes[p as ViewerPurpose]===match[1]) as ViewerPurpose|undefined;
 return purpose?{purpose,token:match[2]!}:null;
}
/** Fail closed unless the exact card revision is really published.
 * This is independent of the existence of a draft or a 'sent' delivery row.
 */
export async function resolvePublishedProfileView(token:string):Promise<SavedProfile|null>{
 if(!VIEW_TOKEN_PATTERN.test(token))return null;
 const rows=await pool.query(
  `SELECT l.owner_user_id,l.profile_revision,pub.public_snapshot
   FROM profile_view_links l
   JOIN profiles p ON p.owner_user_id=l.owner_user_id AND p.status='published'
   JOIN posting_topics t ON t.topic_id=l.topic_id
      AND t.purpose='profile' AND t.enabled=TRUE
      AND t.verified_at IS NOT NULL AND t.verified_by IS NOT NULL
   JOIN profile_publications pub ON pub.owner_user_id=l.owner_user_id
      AND pub.chat_id=t.chat_id AND pub.thread_id=t.message_thread_id
      AND pub.status='published' AND pub.synced_revision=l.profile_revision
      AND pub.public_snapshot IS NOT NULL
   WHERE l.token=$1 AND l.enabled=TRUE`,
  [token]);
 if(rows.rows.length!==1)return null;
 return restorePublishedSnapshot(Number(rows.rows[0].owner_user_id),
   rows.rows[0].public_snapshot as PublicProfileSnapshot,Number(rows.rows[0].profile_revision));
}

/** ROOM only links to an already published, permission-checked profile card.
 * Never create a new profile publication or reveal a private draft.
 */
export async function existingPublishedProfileUrl(ownerId:number):Promise<string|null>{
 assertId(ownerId);
 const r=await pool.query(
  `SELECT l.token
    FROM profile_view_links l
    JOIN profile_publications pub
      ON pub.owner_user_id=l.owner_user_id
      AND pub.synced_revision=l.profile_revision
      AND pub.status='published' AND pub.public_snapshot IS NOT NULL
    JOIN posting_topics t
      ON t.topic_id=l.topic_id AND t.chat_id=pub.chat_id
      AND t.message_thread_id=pub.thread_id
      AND t.purpose='profile' AND t.enabled=TRUE
      AND t.verified_at IS NOT NULL AND t.verified_by IS NOT NULL
    JOIN profiles p ON p.owner_user_id=l.owner_user_id
      AND p.status='published'
    WHERE l.owner_user_id=$1 AND l.enabled=TRUE
    ORDER BY l.profile_revision DESC LIMIT 1`,[ownerId]);
 return r.rows.length===1?profileViewerUrl("profile",String(r.rows[0].token)):null;
}
