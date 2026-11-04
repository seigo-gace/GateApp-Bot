import { randomBytes } from "node:crypto";
import { escapeProfileHtml } from "./profileCore.js";

export const ANNOUNCEMENT_KINDS=["announcement","preview","recruitment"] as const;
export type AnnouncementKind=typeof ANNOUNCEMENT_KINDS[number];
export type RoomMode="jitsi"|"external";
export type RoomStatus="draft"|"scheduled"|"ready"|"cancelled"|"finished";

export type RoomDraft={
 ownerId:number; name:string; mode:RoomMode;
 externalUrl?:string|null; startAt?:Date|null;
 status:RoomStatus;
};
export type AnnouncementDraft={
 ownerId:number; kind:AnnouncementKind; text:string;
 eventAt?:Date|null; publishAt?:Date|null; deadlineAt?:Date|null;
 capacity?:number|null; roomId?:number|null;
};

export function assertHttpsMeetingUrl(value:string):string {
 const trimmed=value.trim();
 if(trimmed.length>2048)throw new Error("ROOM_URL_TOO_LONG");
 let url:URL;
 try{url=new URL(trimmed);}catch{throw new Error("ROOM_URL_INVALID");}
 if(url.protocol!=="https:"||!url.hostname||url.username||url.password||
    url.hostname==="localhost"||url.hostname.endsWith(".localhost")||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname)||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname)||
    url.hostname==="[::1]")throw new Error("ROOM_URL_NOT_PUBLIC_HTTPS");
 return url.toString();
}
export function createJitsiJoinUrl():string {
 // 128 bits of entropy in URL path; never derived from Telegram user or group.
 return "https://meet.jit.si/GayBBS-" + randomBytes(16).toString("hex");
}
export function validateRoom(d:RoomDraft):RoomDraft{
 if(!Number.isSafeInteger(d.ownerId)||d.ownerId<=0)throw new Error("ROOM_OWNER_INVALID");
 if(!d.name.trim()||d.name.length>100)throw new Error("ROOM_NAME_INVALID");
 if(d.mode!=="jitsi"&&d.mode!=="external")throw new Error("ROOM_MODE_INVALID");
 if(d.mode==="external"&&!d.externalUrl)throw new Error("ROOM_URL_REQUIRED");
 if(d.externalUrl)assertHttpsMeetingUrl(d.externalUrl);
 if(d.startAt && (!Number.isFinite(d.startAt.getTime())||d.startAt.getTime()<Date.now()-60000))
  throw new Error("ROOM_START_INVALID");
 return d;
}
export function buildRoomCard(d:RoomDraft,joinUrl:string):string {
 validateRoom(d);
 return [
  "🎬 ROOM："+escapeProfileHtml(d.name.trim()),
  "方式："+(d.mode==="jitsi"?"Jitsi":"持込URL"),
  "開催："+(d.startAt?d.startAt.toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})+"（日本時間）":"即時"),
  "状態："+({draft:"下書き",scheduled:"開催予定",ready:"準備完了",cancelled:"中止",finished:"終了"}[d.status]),
  // Room URL belongs on a separate, explicit join button when released.
 ].join("\n");
}
export function validateAnnouncement(d:AnnouncementDraft):AnnouncementDraft{
 if(!Number.isSafeInteger(d.ownerId)||d.ownerId<=0)throw new Error("ANNOUNCEMENT_OWNER_INVALID");
 if(!ANNOUNCEMENT_KINDS.includes(d.kind))throw new Error("ANNOUNCEMENT_KIND_INVALID");
 if(!d.text.trim()||d.text.length>3500)throw new Error("ANNOUNCEMENT_TEXT_INVALID");
 if(d.kind==="preview"&&!d.eventAt)throw new Error("PREVIEW_EVENT_DATE_REQUIRED");
 if(d.kind!=="recruitment"&&(d.capacity||d.deadlineAt))
  throw new Error("ANNOUNCEMENT_RECRUITMENT_ONLY_FIELDS");
 if(d.capacity!==undefined&&d.capacity!==null&&
   (!Number.isInteger(d.capacity)||d.capacity<1||d.capacity>1000))
  throw new Error("RECRUITMENT_CAPACITY_INVALID");
 for(const date of [d.eventAt,d.publishAt,d.deadlineAt]){
  if(date&& !Number.isFinite(date.getTime()))throw new Error("ANNOUNCEMENT_DATE_INVALID");
 }
 return d;
}
export function buildAnnouncementCard(d:AnnouncementDraft):string{
 validateAnnouncement(d);
 const heading=d.kind==="announcement"?"📢 告知":d.kind==="preview"?"📅 予告":"📣 相手募集";
 const rows=[heading,escapeProfileHtml(d.text.trim())];
 if(d.eventAt)rows.push("開催："+d.eventAt.toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})+"（日本時間）");
 if(d.kind==="recruitment"&&d.capacity)rows.push("定員："+d.capacity+"人");
 if(d.kind==="recruitment"&&d.deadlineAt)rows.push("応募締切："+d.deadlineAt.toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})+"（日本時間）");
 return rows.join("\n");
}

/** Parse one Japanese-local input into UTC. Japan has no DST. */
export function parseJstDateTime(input:string):Date{
 const m=input.trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})$/);
 if(!m)throw new Error("日時形式は YYYY/MM/DD HH:mm です");
 const [year,month,day,hour,minute]=m.slice(1).map(Number);
 if(year<2020||year>2100||month<1||month>12||day<1||day>31||
    hour<0||hour>23||minute<0||minute>59)
   throw new Error("日時の値が不正です");
 const when=new Date(Date.UTC(year,month-1,day,hour-9,minute));
 const check=new Date(when.getTime()+9*60*60*1000);
 if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||
    check.getUTCDate()!==day||check.getUTCHours()!==hour||
    check.getUTCMinutes()!==minute)
   throw new Error("存在しない日時です");
 if(when.getTime()<Date.now()-60000)throw new Error("過去の日時は指定できません");
 return when;
}
