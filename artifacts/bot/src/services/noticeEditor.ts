/** General-user notice editor only. Never changes Recruitment/Room/Profile state. */
import {escapeProfileHtml} from "./profileCore.js";
import {parseJstDateTime,validateAnnouncement} from "./postingDomain.js";
export type NoticeJoin="none"|"public"|"approved_only";
export type NoticeMedia={kind:"photo"|"video"|"sticker";fileId:string};
export type NoticeDraft=Record<string,unknown>;
export function noticeParts(data:NoticeDraft):{title:string;body:string}{
 const source=String(data.text||"");
 const [rawTitle,...rest]=source.split("\n");
 return {title:String(data.title??rawTitle??"").trim(),
  body:String(data.body??rest.join("\n")??"").trim()};
}
export function noticeText(data:NoticeDraft):string{
 const {title,body}=noticeParts(data);
 return [title,body].filter(Boolean).join("\n");
}
export function noticeLink(url:string):string{
 const u=new URL(url.trim());
 if(u.protocol!=="https:"||!u.hostname||u.username||u.password||
  ["localhost","127.0.0.1","::1"].includes(u.hostname)||u.hostname.endsWith(".local"))
  throw Error("告知リンクは公開HTTPSのURLを入力してください");
 return u.toString();
}
/** The very same validated URL button is used in the DM and public card. */
export function noticeUrlButton(data:NoticeDraft):{text:string;url:string}|undefined{
 if(!data.linkLabel||!data.linkUrl)return undefined;
 return {text:String(data.linkLabel),url:noticeLink(String(data.linkUrl))};
}
export type NoticeStickerPreview={fileId:string;messageId:number|null};
export function noticeStickerPreviews(data:NoticeDraft):NoticeStickerPreview[]{
 return (Array.isArray(data.noticeStickerPreviews)?data.noticeStickerPreviews:[]).filter(
 (x):x is NoticeStickerPreview=>!!x&&typeof x==="object"&&typeof x.fileId==="string"&&
 (x.messageId===null||(Number.isSafeInteger(x.messageId)&&x.messageId>0))).slice(0,5);
}
export function noticeJoin(data:NoticeDraft):NoticeJoin{
 return data.participation==="public"?"public":
  data.participation==="approved_only"?"approved_only":"none";
}
export function noticeMedia(data:NoticeDraft):NoticeMedia[]{
 const value=Array.isArray(data.media)?data.media:[];
 return value.filter((x):x is NoticeMedia=>!!x&&typeof x==="object"&&
  (x.kind==="photo"||x.kind==="video"||x.kind==="sticker")&&
  typeof x.fileId==="string"&&x.fileId.length>0).slice(0,5);
}
export function noticeEdit(data:NoticeDraft,field:string,input:string):NoticeDraft{
 const value=input.trim(),parts=noticeParts(data);
 if(field==="title"){
  if(value.length>100||value.includes("\n"))throw Error("タイトルは100文字以内です");
  return {...data,title:value,text:value+"\n"+parts.body};
 }
 if(field==="body"){
  if(value.length>3200)throw Error("本文は3200文字以内です");
  return {...data,body:input.trim(),text:parts.title+"\n"+input.trim()};
 }
 if(field==="deadline"){
  return {...data,deadlineAt:value==="なし"?null:parseJstDateTime(value).toISOString()};
 }
 if(field==="link"){
  if(value==="なし")return {...data,linkLabel:null,linkUrl:null};
  const [label,url,...extra]=value.split(/\r?\n/);
  if(extra.length||!label?.trim()||label.length>64||!url?.trim())throw Error("1行目にボタン名、2行目にHTTPS URLを入力してください");
  return {...data,linkLabel:label.trim(),linkUrl:noticeLink(url)};
 }
 if(field==="media"){
  if(value!=="なし")throw Error("画像・動画・ステッカーを送信するか「なし」と入力してください");
  return {...data,media:[]};
 }
 throw Error("告知編集の項目が無効です");
}
export function validateNotice(data:NoticeDraft,ownerId:number):void{
 const parts=noticeParts(data),text=noticeText(data);
 if(!text.trim()&&!noticeMedia(data).length)throw Error("文章または画像・動画・ステッカーを登録してください");
 const event=data.eventAt?new Date(String(data.eventAt)):undefined;
 const deadline=data.deadlineAt?new Date(String(data.deadlineAt)):undefined;
 // The shared announcement validator reserves its deadline/required date for
 // Recruitment. General notice dates and deadlines are independently optional.
 validateAnnouncement({ownerId,kind:"announcement",text:text||"媒体のみ",eventAt:event});
 if(deadline&&!Number.isFinite(deadline.getTime()))throw Error("ANNOUNCEMENT_DATE_INVALID");
 if(data.linkLabel||data.linkUrl){
  if(!data.linkLabel||!data.linkUrl)throw Error("リンク名とURLが両方必要です");
  noticeLink(String(data.linkUrl));
 }
}
export function noticeCard(data:NoticeDraft,ownerId:number):string{
 validateNotice(data,ownerId);
 const parts=noticeParts(data);
 const dt=(input:unknown)=>new Date(String(input)).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
 const lines=[data.kind==="preview"?"📅 予告":"📢 告知",
  ...(parts.title?[escapeProfileHtml(parts.title)]:[]),
  ...(parts.body?[escapeProfileHtml(parts.body)]:[])];
 if(data.eventAt)lines.push("開催："+dt(data.eventAt));
 if(data.deadlineAt)lines.push("受付終了："+dt(data.deadlineAt));
 return lines.join("\n");
}

/** Private notice preview only: native RichTextButton callbacks, not deep links.
 * The existing announcementPanel owns the eight InlineKeyboard controls.
 * No sending, persistence or public-card rendering is performed here.
 */
export function buildNoticeRichPreview(data:NoticeDraft,revision:number){
 if(!Number.isSafeInteger(revision)||revision<=0)throw Error("NOTICE_REVISION_INVALID");
 const {title,body}=noticeParts(data);
 const join=noticeJoin(data);
 const paragraph=(text:unknown):Record<string,unknown>=>({type:"paragraph",text});
 const edit=(field:"title"|"body")=>({
  type:"button",button:{text:"［編集］",style:"link",callback_data:`post:announce:${field}:${revision}`}
 });
 const fieldLine=(label:string,value:string,field:"title"|"body")=>
  paragraph(value?[edit(field)," "+label+"："+value]:label+"：［未設定］");
 const dt=(value:unknown)=>value?new Date(String(value)).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}):"［未設定］";
 const blocks:Record<string,unknown>[]=[
  paragraph("📢 告知/予告"),
  fieldLine("タイトル",title,"title"),
  fieldLine("説明",body,"body"),
  paragraph("開催日時："+dt(data.eventAt)),
  paragraph("受付期限："+dt(data.deadlineAt)),
  paragraph("参加方法："+(join==="public"?"自由参加":join==="approved_only"?"承認制":"［未設定］")),
 ];
 if(data.destinationLabel)blocks.push(paragraph("投稿先："+String(data.destinationLabel)));
 const stickers=noticeMedia(data).filter(x=>x.kind==="sticker");
 if(stickers.length)blocks.push(paragraph("ステッカー："+stickers.length+"件（実物は別メッセージで表示）"));
 for(const media of noticeMedia(data)){
  if(media.kind==="sticker")continue; // Telegram has no native Rich sticker block.
  blocks.push(media.kind==="photo"
   ?{type:"photo",photo:{type:"photo",media:media.fileId}}
   :{type:"video",video:{type:"video",media:media.fileId}});
 }
 const link=noticeUrlButton(data);
 if(link){
  blocks.push(paragraph("🔗 リンクボタン（タップして確認）"));
  blocks.push({type:"buttons",buttons:[link]});
 }
 return {blocks};
}
