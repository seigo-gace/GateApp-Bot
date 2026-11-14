/** General-user notice editor only. Never changes Recruitment/Room/Profile state. */
import {escapeProfileHtml} from "./profileCore.js";
import {parseJstDateTime,validateAnnouncement} from "./postingDomain.js";
export type NoticeJoin="none"|"public"|"approved_only";
export type NoticeMedia={kind:"photo"|"video";fileId:string};
export type NoticeDraft=Record<string,unknown>;
export function noticeParts(data:NoticeDraft):{title:string;body:string}{
 const source=String(data.text||"");
 const [rawTitle,...rest]=source.split("\n");
 return {title:String(data.title??rawTitle??"").trim(),
  body:String(data.body??rest.join("\n")??"").trim()};
}
export function noticeText(data:NoticeDraft):string{
 const {title,body}=noticeParts(data);
 return title+"\n"+body;
}
export function noticeLink(url:string):string{
 const u=new URL(url.trim());
 if(u.protocol!=="https:"||!u.hostname||u.username||u.password||
  ["localhost","127.0.0.1","::1"].includes(u.hostname)||u.hostname.endsWith(".local"))
  throw Error("告知リンクは公開HTTPSのURLを入力してください");
 return u.toString();
}
export function noticeJoin(data:NoticeDraft):NoticeJoin{
 return data.participation==="public"?"public":
  data.participation==="approved_only"?"approved_only":"none";
}
export function noticeMedia(data:NoticeDraft):NoticeMedia[]{
 const value=Array.isArray(data.media)?data.media:[];
 return value.filter((x):x is NoticeMedia=>!!x&&typeof x==="object"&&
  (x.kind==="photo"||x.kind==="video")&&
  typeof x.fileId==="string"&&x.fileId.length>0).slice(0,5);
}
export function noticeEdit(data:NoticeDraft,field:string,input:string):NoticeDraft{
 const value=input.trim(),parts=noticeParts(data);
 if(field==="title"){
  if(!value||value.length>100||value.includes("\n"))throw Error("タイトルは1〜100文字です");
  return {...data,title:value,text:value+"\n"+parts.body};
 }
 if(field==="body"){
  if(!value||value.length>3200)throw Error("本文は1〜3200文字です");
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
  if(value!=="なし")throw Error("画像・動画を送信するか「なし」と入力してください");
  return {...data,media:[]};
 }
 throw Error("告知編集の項目が無効です");
}
export function validateNotice(data:NoticeDraft,ownerId:number):void{
 const parts=noticeParts(data),text=noticeText(data);
 if(!parts.title||!parts.body)throw Error("タイトルと本文を入力してください");
 const event=data.eventAt?new Date(String(data.eventAt)):undefined;
 const deadline=data.deadlineAt?new Date(String(data.deadlineAt)):undefined;
 validateAnnouncement({ownerId,kind:data.kind==="preview"?"preview":"announcement",text,eventAt:event,deadlineAt:deadline});
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
  escapeProfileHtml(parts.title),escapeProfileHtml(parts.body)];
 if(data.eventAt)lines.push("開催："+dt(data.eventAt));
 if(data.deadlineAt)lines.push("受付終了："+dt(data.deadlineAt));
 return lines.join("\n");
}
