/** Shared read-only search filters; consumes adopted profile/announcement catalogs. */
import {PROFILE_AREA_BLOCKS,isAreaBlock} from "./profileArea.js";
import {PROFILE_POSITIONS} from "./profileCore.js";
import {PURPOSE_TAGS} from "./announcementTags.js";
import {nextSelection} from "./inlineSelection.js";
export type SearchKind="profile"|"recruitment";
export type SearchFilters={kind:SearchKind;keyword:string;region:string|null;position:string|null;purpose:string|null};
export const initialSearchFilters=():SearchFilters=>({kind:"profile",keyword:"",region:null,position:null,purpose:null});
export function searchOptions(key:"region"|"position"|"purpose"):readonly string[]{
 return key==="region"?PROFILE_AREA_BLOCKS:key==="position"?PROFILE_POSITIONS:PURPOSE_TAGS;
}
export function setSearchFilter(f:SearchFilters,key:"region"|"position"|"purpose",value:string):SearchFilters{
 const choices=searchOptions(key);
 if(!choices.includes(value))throw Error("SEARCH_OPTION_INVALID");
 const selected=nextSelection("single-optional",f[key]?[f[key]!]:[],value,choices);
 return {...f,[key]:selected[0]??null};
}
export function validateSearch(f:SearchFilters):SearchFilters{
 if(!["profile","recruitment"].includes(f.kind)||
  f.keyword.length>80||/[\u0000-\u001f]/.test(f.keyword)||
  f.region!==null&&!isAreaBlock(f.region)||
  f.position!==null&&!PROFILE_POSITIONS.includes(f.position as typeof PROFILE_POSITIONS[number])||
  f.purpose!==null&&!PURPOSE_TAGS.includes(f.purpose as typeof PURPOSE_TAGS[number]))
  throw Error("SEARCH_FILTER_INVALID");
 return f;
}
export function telegramPublishedMessageUrl(chatId:number,messageId:number):string{
 const c=String(chatId);
 if(!/^-100[1-9]\d+$/.test(c)||!Number.isSafeInteger(messageId)||messageId<1)
  throw Error("SEARCH_PUBLIC_LINK_UNVERIFIED");
 return "https://t.me/c/"+c.slice(4)+"/"+messageId;
}
