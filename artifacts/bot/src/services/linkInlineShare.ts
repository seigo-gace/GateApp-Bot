/** Registered inline sharing of the existing link-button post source.
 * Same owner, data model, URL validation and Telegram IDs; no second publisher.
 */
import {randomBytes} from "node:crypto";
import {pool} from "../db/index.js";
import {buttonGrid,validateLinkDraft,type LinkDraft} from "./linkButtonDomain.js";

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
     caption_above,share_code)
   VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
   ON CONFLICT(request_key) DO UPDATE SET
     request_key=EXCLUDED.request_key
   RETURNING link_post_id,owner_user_id,content,buttons,columns,media_kind,
     media_file_id,caption_above,share_code`,
  [key,ownerId,draft.text,JSON.stringify(draft.buttons),draft.columns,
   media?.type??null,media?.fileId??null,draft.captionAbove===true,code]);
 if(q.rows.length!==1)throw Error("LINK_SHARE_REGISTER_UNCONFIRMED");
 const row=q.rows[0];
 const persisted:LinkDraft={text:String(row.content),buttons:row.buttons,
  columns:Number(row.columns),
  ...(row.media_kind?{media:{type:row.media_kind,fileId:row.media_file_id}}:{}),
  captionAbove:row.caption_above===true};
 const normal=(v:LinkDraft)=>JSON.stringify({
  text:v.text,
  buttons:v.buttons.map(b=>[b.label,b.url,b.rowStart??null,b.style??null]),
  columns:v.columns,media:v.media?[v.media.type,v.media.fileId]:null,
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
      media_file_id,caption_above FROM link_button_posts
    WHERE owner_user_id=$1 AND share_code=$2 AND status='draft'`,[ownerId,code]);
 if(q.rows.length!==1)return null;
 const row=q.rows[0];
 const draft:LinkDraft={text:row.content,buttons:row.buttons,columns:Number(row.columns),
   ...(row.media_kind?{media:{type:row.media_kind,fileId:row.media_file_id}}:{}),
   captionAbove:row.caption_above===true};
 validateLinkDraft(draft);
 return {sourceId:String(row.link_post_id),ownerId,draft};
}

export function linkInlineResult(post:LinkInlinePost):Record<string,unknown>{
 const {draft,sourceId}=post;
 validateLinkDraft(draft);
 const reply_markup={inline_keyboard:buttonGrid(draft).map(row=>row.map(b=>({
  text:b.label,url:b.url,...(b.style?{style:b.style}:{}),
 })))};
 const id="link_"+sourceId;
 if(!draft.media)return {
  type:"article",id,title:draft.text.slice(0,80)||"投稿",
  description:"登録済みのテキスト投稿",
  input_message_content:{message_text:draft.text},
  reply_markup,
 };
 const base={id,caption:draft.text,
  show_caption_above_media:draft.captionAbove===true,reply_markup};
 if(draft.media.type==="photo")return {
  type:"photo",photo_file_id:draft.media.fileId,...base,
 };
 return {
  type:"video",video_file_id:draft.media.fileId,
  title:draft.text.slice(0,80)||"動画投稿",...base,
 };
}
