/** LinkButton editor domain; adapted to existing MPB button renderer contract.
 * Safety: format & known redirectors are checked; not a remote malware scan.
 */
import {escapeProfileHtml} from "./profileCore.js";
export type LinkButton={label:string;url:string;rowStart?:boolean;style?:"primary"|"success"|"danger"};
export type LinkMedia={type:"photo"|"video"|"document";fileId:string;caption?:string};
export type LinkDraft={text:string;buttons:LinkButton[];columns:1|2|3;media?:LinkMedia;mediaExtras?:LinkMedia[];captionAbove?:boolean};
const SHORTENERS=new Set(["bit.ly","tinyurl.com","t.co","is.gd","cutt.ly",
 "tiny.cc","rb.gy","rebrand.ly","goo.gl","ow.ly","shorturl.at"]);
export function validateLinkDestination(raw:string):string{
 const val=raw.trim();
 if(val.length>2048||!val)throw new Error("LINK_URL_INVALID");
 let url:URL;
 try{url=new URL(val)}catch{throw new Error("LINK_URL_INVALID");}
 if(url.protocol!=="https:"||!url.hostname||url.username||url.password||
    SHORTENERS.has(url.hostname)||url.port&&url.port!=="443"||
    url.hostname==="localhost"||url.hostname.endsWith(".localhost")||
    url.hostname.endsWith(".local")||url.hostname.endsWith(".internal")||
    /^\d+(?:\.\d+){3}$/.test(url.hostname)||
    url.hostname.startsWith("[")||
    url.hostname==="0"||
    url.hostname.endsWith(".onion"))
  throw new Error("LINK_HOST_NOT_ALLOWED");
 return url.toString();
}
export function validateLinkDraft(d:LinkDraft):LinkDraft{
 if((!d.text.trim()&&!d.media)||d.text.length>(d.media?1024:3500))
  throw new Error("LINK_BODY_INVALID");
 const mediaItems=[...(d.media?[d.media]:[]),...(d.mediaExtras??[])];
 if(!Array.isArray(d.mediaExtras??[])||mediaItems.length>50||
    (d.mediaExtras?.length&&!d.media))throw new Error("LINK_MEDIA_ALBUM_INVALID");
 for(const media of mediaItems){
  if(!["photo","video","document"].includes(media.type)||!media.fileId||media.fileId.length>512||
     (media.caption!==undefined&&(typeof media.caption!=="string"||media.caption.length>1024)))
   throw new Error("LINK_MEDIA_INVALID");
 }
 if(![1,2,3].includes(d.columns))throw new Error("LINK_COLUMN_INVALID");
 if(!Array.isArray(d.buttons)||!d.buttons.length||d.buttons.length>100)
  throw new Error("LINK_BUTTON_COUNT_INVALID");
 for(const b of d.buttons){
  if(!b.label.trim()||b.label.length>64)throw new Error("LINK_LABEL_INVALID");
  validateLinkDestination(b.url);
  if(b.style!==undefined&&!["primary","success","danger"].includes(b.style))throw Error("LINK_STYLE_INVALID");
 }
 return d;
}
/** Telegram DM: a single two-line message creates exactly one URL button.
 * Line 1: displayed name, line 2: complete https:// destination.
 * A blank name, extra line, or malformed URL is rejected without changing the draft.
 */
export function parseLinkButtonPair(input:string):LinkButton{
 const lines=input.replace(/\r\n?/g,"\n").split("\n").map(line=>line.trim());
 if(lines.length!==2||!lines[0]||!lines[1])
  throw new Error("ボタン名とURLを2行でまとめて送信してください。");
 const label=lines[0];
 if(label.length>64)throw new Error("LINK_LABEL_INVALID");
 return {label,url:validateLinkDestination(lines[1])};
}
/** Legacy input compatibility only. New Master-accepted wizard uses parseLinkButtonPair. */
export function parseLinkInput(input:string):Pick<LinkDraft,"text"|"buttons">{
 const lines=input.trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(lines.length<2)throw new Error("本文1行とボタン1個以上を入力してください");
 const text=lines[0]!;
 const buttons=lines.slice(1).map(line=>{
  const pos=line.indexOf("|");
  if(pos<=0)throw new Error("各ボタンは「表示名 | https://...」の形式です");
  const label=line.slice(0,pos).trim();
  const url=validateLinkDestination(line.slice(pos+1));
  return {label,url};
 });
 validateLinkDraft({text,buttons,columns:1});
 return {text,buttons};
}
export function renderLinkCard(d:LinkDraft):string{
 validateLinkDraft(d);
 return (d.text.trim()?escapeProfileHtml(d.text.trim()):"🔗 リンク投稿");
}
export function buttonGrid(d:LinkDraft):Array<Array<LinkButton>>{
 validateLinkDraft(d);
 const rows:LinkButton[][]=[];
 // Preserve the old evenly-spaced layout for saved drafts without row markers.
 const hasExplicitRows=d.buttons.some(b=>typeof b.rowStart==="boolean");
 if(!hasExplicitRows){
  for(let i=0;i<d.buttons.length;i+=d.columns)rows.push(d.buttons.slice(i,i+d.columns));
  return rows;
 }
 for(const [index,button] of d.buttons.entries()){
  if(index===0||button.rowStart===true)rows.push([button]);
  else rows[rows.length-1]!.push(button);
 }
 return rows;
}

/** Insert a new button to the right of the chosen row, not necessarily the last row.
 * rowIndex is zero-based; other rows remain unchanged.
 */
export function insertLinkButton(d:LinkDraft,button:LinkButton,location:
 {kind:"newRow"}|{kind:"right";rowIndex:number}):LinkButton[]{
 const rows=buttonGrid(d).map(row=>row.map(b=>({...b})));
 if(location.kind==="newRow")rows.push([{...button,rowStart:true}]);
 else {
  if(!Number.isInteger(location.rowIndex)||location.rowIndex<0||location.rowIndex>=rows.length)
   throw new Error("LINK_ROW_INVALID");
  // Master: link-button row length is user-defined; no artificial four-column cap.
  rows[location.rowIndex]!.push({...button,rowStart:false});
 }
 if(rows.flat().length>100)throw new Error("LINK_BUTTON_COUNT_INVALID");
 return rows.flatMap(row=>row.map((b,i)=>({...b,rowStart:i===0})));
}
