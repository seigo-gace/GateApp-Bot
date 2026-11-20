/** Registered inline sharing of the existing link-button post source.
 * Same owner, data model, URL validation and Telegram IDs; no second publisher.
 */
import {randomBytes} from "node:crypto";
import {pool} from "../db/index.js";
import {validateLinkDraft,type LinkDraft} from "./linkButtonDomain.js";
import {linkRichPublication} from "./linkRichPreview.js";

export type LinkShareReceipt={code:string;sourceId:string};
export type LinkInlinePost={ownerId:number;sourceId:string;draft:LinkDraft};

export async function registerLinkShare(ownerId:number,revision:number,draft:LinkDraft):
 Promise<LinkShareReceipt>{
 if(!Number.isSafeInteger(ownerId)||ownerId<=0||
  !Number.isSafeInteger(revision)||revision<=0)throw Error("LINK_OWNER_REVISION_INVALID");
 validateLinkDraft(draft);
 const key="link:"+ownerId+":"+revision;
 const code=randomBytes(18).toString("base64url");
 const media=draft.media??null;
 const q=await pool.query(
  `INSERT INTO link_button_posts
    (request_key,owner_user_id,content,buttons,columns,media_kind,media_file_id,
     caption_above,share_code,media_extras)
   VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb)
   ON CONFLICT(request_key) DO UPDATE SET
     request_key=EXCLUDED.request_key
   RETURNING link_post_id,owner_user_id,content,buttons,columns,media_kind,
     media_file_id,caption_above,share_code,media_extras`,
  [key,ownerId,draft.text,JSON.stringify(draft.buttons),draft.columns,
   media?.type??null,media?.fileId??null,draft.captionAbove===true,code,
   JSON.stringify(draft.mediaExtras??[])]);
 if(q.rows.length!==1)throw Error("LINK_SHARE_REGISTER_UNCONFIRMED");
 const row=q.rows[0];
 const persisted:LinkDraft={text:String(row.content),buttons:row.buttons,
  columns:Number(row.columns) as 1|2|3,
  ...(row.media_kind?{media:{type:row.media_kind,fileId:row.media_file_id}}:{}),
  mediaExtras:Array.isArray(row.media_extras)?row.media_extras:[],
  captionAbove:row.caption_above===true};
 const normal=(v:LinkDraft)=>JSON.stringify({
  text:v.text,
  buttons:v.buttons.map(b=>[b.label,b.url,b.rowStart??null,b.style??null]),
  columns:v.columns,media:v.media?[v.media.type,v.media.fileId,v.media.caption??null]:null,
  mediaExtras:(v.mediaExtras??[]).map(m=>[m.type,m.fileId,m.caption??null]),
  captionAbove:v.captionAbove===true,
 });
 // JSONB reorders object fields, so compare stable tuples, not raw JSON strings.
 if(normal(persisted)!==normal(draft))throw Error("LINK_SHARE_REGISTER_CONFLICT");
 if(!/^[A-Za-z0-9_-]{24}$/.test(row.share_code))
  throw Error("LINK_SHARE_READBACK_INVALID");
 return {sourceId:String(row.link_post_id),code:String(row.share_code)};
}

export async function readLinkShare(ownerId:number,code:string):Promise<LinkInlinePost|null>{
 if(!Number.isSafeInteger(ownerId)||ownerId<=0||
   !/^[A-Za-z0-9_-]{24}$/.test(code))return null;
 const q=await pool.query(
  `SELECT link_post_id,owner_user_id,content,buttons,columns,media_kind,
      media_file_id,caption_above,media_extras FROM link_button_posts
    WHERE owner_user_id=$1 AND share_code=$2 AND status='draft'`,[ownerId,code]);
 if(q.rows.length!==1)return null;
 const row=q.rows[0];
 const draft:LinkDraft={text:row.content,buttons:row.buttons,columns:Number(row.columns) as 1|2|3,
   ...(row.media_kind?{media:{type:row.media_kind,fileId:row.media_file_id}}:{}),
   mediaExtras:Array.isArray(row.media_extras)?row.media_extras:[],
   captionAbove:row.caption_above===true};
 validateLinkDraft(draft);
 return {sourceId:String(row.link_post_id),ownerId,draft};
}

/** The inline result is the SAME Rich Message shown in the final-preview body.
 * No parallel photo/video-only exporter: mixed Rich media and URL buttons stay intact.
 */
export function linkInlineResult(post:LinkInlinePost):Record<string,unknown>{
 const {draft,sourceId}=post;
 validateLinkDraft(draft);
 return {
  type:"article",id:"link_"+sourceId,
  title:draft.text.slice(0,80)||"🔗 リンク投稿",
  description:"登録済み投稿をそのまま共有します",
  input_message_content:{rich_message:linkRichPublication(draft)},
 };
}
