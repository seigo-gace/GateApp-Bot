/** LinkButton editor domain; adapted to existing MPB button renderer contract.
 * Safety: format & known redirectors are checked; not a remote malware scan.
 */
import {escapeProfileHtml} from "./profileCore.js";
export type LinkButton={label:string;url:string};
export type LinkDraft={text:string;buttons:LinkButton[];columns:1|2|3};
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
 if(!d.text.trim()||d.text.length>3500)throw new Error("LINK_BODY_INVALID");
 if(![1,2,3].includes(d.columns))throw new Error("LINK_COLUMN_INVALID");
 if(!Array.isArray(d.buttons)||!d.buttons.length||d.buttons.length>100)
  throw new Error("LINK_BUTTON_COUNT_INVALID");
 for(const b of d.buttons){
  if(!b.label.trim()||b.label.length>64)throw new Error("LINK_LABEL_INVALID");
  validateLinkDestination(b.url);
 }
 return d;
}
/** One message: first line body, then label | https://... per button. */
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
 return "🔗 リンク投稿\n"+escapeProfileHtml(d.text.trim());
}
export function buttonGrid(d:LinkDraft):Array<Array<LinkButton>>{
 validateLinkDraft(d);
 const rows:LinkButton[][]=[];
 for(let i=0;i<d.buttons.length;i+=d.columns)rows.push(d.buttons.slice(i,i+d.columns));
 return rows;
}
