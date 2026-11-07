/** Searches only records with a published Telegram receipt, never private drafts. */
import {pool} from "../db/index.js";
import {initialSearchFilters,validateSearch,type SearchFilters,telegramPublishedMessageUrl} from "./searchDomain.js";
export type SearchSession={revision:number;step:"home"|"keyword"|"age"|"region"|"position"|"purpose"|"hair"|"body"|"like"|"love"|"results";screenMessageId:number|null;filters:SearchFilters};
export type SearchHit={title:string;description:string;url:string};
const validId=(id:number)=>{if(!Number.isSafeInteger(id)||id<=0)throw Error("SEARCH_USER_INVALID");return id;};
export async function getSearchSession(id:number):Promise<SearchSession|null>{
 const r=await pool.query("SELECT revision,step,screen_message_id,filters FROM gaybbs_search_sessions WHERE owner_user_id=$1",[validId(id)]);
 if(!r.rows.length)return null;
 const x=r.rows[0];return {revision:Number(x.revision),step:x.step,screenMessageId:x.screen_message_id?Number(x.screen_message_id):null,filters:validateSearch(x.filters)};
}
export async function beginSearch(id:number):Promise<SearchSession>{
 const r=await pool.query(`INSERT INTO gaybbs_search_sessions(owner_user_id,filters)
 VALUES($1,$2::jsonb) ON CONFLICT(owner_user_id) DO UPDATE SET
 step='home',filters=EXCLUDED.filters,revision=gaybbs_search_sessions.revision+1,
 updated_at=NOW() RETURNING *`,[validId(id),JSON.stringify(initialSearchFilters())]);
 const x=r.rows[0];return {revision:Number(x.revision),step:x.step,screenMessageId:x.screen_message_id?Number(x.screen_message_id):null,filters:validateSearch(x.filters)};
}
export async function updateSearch(id:number,rev:number,step:SearchSession["step"],filters:SearchFilters):Promise<SearchSession>{
 const r=await pool.query(`UPDATE gaybbs_search_sessions SET step=$3,filters=$4::jsonb,
 revision=revision+1,updated_at=NOW() WHERE owner_user_id=$1 AND revision=$2
 RETURNING *`,[validId(id),rev,step,JSON.stringify(validateSearch(filters))]);
 if(r.rows.length!==1)throw Error("SEARCH_SESSION_STALE");
 const x=r.rows[0];return {revision:Number(x.revision),step:x.step,screenMessageId:x.screen_message_id?Number(x.screen_message_id):null,filters:validateSearch(x.filters)};
}
export async function bindSearchScreen(id:number,rev:number,messageId:number):Promise<void>{
 if(!Number.isSafeInteger(messageId)||messageId<=0)throw Error("SEARCH_SCREEN_INVALID");
 const r=await pool.query("UPDATE gaybbs_search_sessions SET screen_message_id=$3 WHERE owner_user_id=$1 AND revision=$2 RETURNING owner_user_id",[validId(id),rev,messageId]);
 if(r.rows.length!==1)throw Error("SEARCH_SESSION_STALE");
}
export async function findPublicSearchHits(filters:SearchFilters,offset:number,limit=5,allowedChats:readonly number[]=[]):Promise<{hits:SearchHit[];hasNext:boolean}>{
 const f=validateSearch(filters);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000||limit<1||limit>10)throw Error("SEARCH_PAGE_INVALID");
 if(allowedChats.some(id=>!Number.isSafeInteger(id)||id>=0))throw Error("SEARCH_CHAT_UNVERIFIED");
 if(!allowedChats.length)return {hits:[],hasNext:false};
 // Filters for profile-only fields never broaden recruitment results.
 if(f.kind==="recruitment"&&(f.hair||f.body||f.ageMin!==null||f.like||f.love))
  return {hits:[],hasNext:false};
 let rows:Record<string,unknown>[];
 if(f.kind==="profile"){
  const r=await pool.query(`SELECT p.nickname,p.age,p.position,p.region,p.area,p.body,
   pub.chat_id,pub.message_id FROM profiles p
   JOIN LATERAL (SELECT chat_id,message_id FROM profile_publications
    WHERE owner_user_id=p.owner_user_id AND status='published' AND message_id IS NOT NULL
     AND chat_id=ANY($7::bigint[])
    ORDER BY updated_at DESC LIMIT 1) pub ON TRUE
   WHERE p.status='published'
    AND ($1::text IS NULL OR p.region=$1)
    AND ($2::text IS NULL OR p.position=$2)
    AND ($3::text='' OR p.nickname ILIKE '%'||$3||'%' OR p.area ILIKE '%'||$3||'%')
    AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM profile_tags t
       WHERE t.owner_user_id=p.owner_user_id AND t.purpose='like' AND t.tag=$4))
    AND p.age BETWEEN COALESCE($8::int,18) AND COALESCE($9::int,89)
    AND ($10::text IS NULL OR p.hair=$10)
    AND ($11::text IS NULL OR p.body=$11)
    AND ($12::text IS NULL OR EXISTS(SELECT 1 FROM profile_tags x
       WHERE x.owner_user_id=p.owner_user_id AND x.purpose='like' AND x.category=$12 AND x.tag=$13))
    AND ($14::text IS NULL OR EXISTS(SELECT 1 FROM profile_tags y
       WHERE y.owner_user_id=p.owner_user_id AND y.purpose='love' AND y.category=$14 AND y.tag=$15))
   ORDER BY p.updated_at DESC,p.owner_user_id DESC LIMIT $5 OFFSET $6`,
   [f.region,f.position,f.keyword,f.purpose,limit+1,offset,allowedChats,
    f.ageMin,f.ageMax,f.hair,f.body,f.like?.category??null,f.like?.tag??null,
    f.love?.category??null,f.love?.tag??null]);rows=r.rows;
 }else{
  const r=await pool.query(`SELECT a.text,a.kind,d.telegram_message_id AS message_id,
   t.chat_id FROM announcement_posts a
   JOIN LATERAL (SELECT d.telegram_message_id,d.posting_topic_id
     FROM posting_deliveries d
     JOIN posting_topics pt ON pt.topic_id=d.posting_topic_id AND pt.enabled=TRUE
     WHERE pt.chat_id=ANY($7::bigint[]) AND d.source_type='announcement' AND d.source_id=a.announcement_id::text
      AND d.status='sent' AND d.telegram_message_id IS NOT NULL
     ORDER BY d.updated_at DESC LIMIT 1) d ON TRUE
   JOIN posting_topics t ON t.topic_id=d.posting_topic_id AND t.enabled=TRUE
   WHERE a.kind='recruitment' AND a.status='published'
     AND ($1::text IS NULL OR a.area_code=$1)
     AND ($2::text IS NULL OR a.conditions->>'position'=$2 OR a.profile_snapshot->>'position'=$2)
     AND ($3::text='' OR a.text ILIKE '%'||$3||'%')
     AND ($4::text IS NULL OR $4=ANY(a.purpose_codes))
   ORDER BY a.updated_at DESC,a.announcement_id DESC LIMIT $5 OFFSET $6`,
   [f.region,f.position,f.keyword,f.purpose,limit+1,offset,allowedChats]);rows=r.rows;
 }
 return {hasNext:rows.length>limit,hits:rows.slice(0,limit).map(x=>({
  title:f.kind==="profile"?String(x.nickname):"📢 相手募集",
  description:f.kind==="profile"?
   [x.age+"歳",x.position,x.region,x.area].filter(Boolean).join(" / "):
   String(x.text).slice(0,90),
  url:telegramPublishedMessageUrl(Number(x.chat_id),Number(x.message_id)),
 }))};
}
