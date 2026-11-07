/** Shared read-only search filters; only adopted profile/announcement catalogs. */
import {PROFILE_AREA_BLOCKS,isAreaBlock} from "./profileArea.js";
import {PROFILE_POSITIONS} from "./profileCore.js";
import {HAIR_CHOICES,BODY_CHOICES} from "./profileAppearance.js";
import {LIKE_CATEGORIES,validLikeTags,type LikeTag} from "./profileLike.js";
import {PURPOSE_TAGS} from "./announcementTags.js";
import {nextSelection} from "./inlineSelection.js";
export type SearchKind="profile"|"recruitment";
export type SearchOptionKey="region"|"position"|"purpose"|"hair"|"body";
export type SearchFilters={kind:SearchKind;keyword:string;region:string|null;
 position:string|null;purpose:string|null;hair:string|null;body:string|null;
 ageMin:number|null;ageMax:number|null;like:LikeTag|null;love:LikeTag|null};
export const initialSearchFilters=():SearchFilters=>({
 kind:"profile",keyword:"",region:null,position:null,purpose:null,
 hair:null,body:null,ageMin:null,ageMax:null,like:null,love:null
});
export function searchOptions(key:SearchOptionKey):readonly string[]{
 switch(key){
  case "region":return PROFILE_AREA_BLOCKS;
  case "position":return PROFILE_POSITIONS;
  case "purpose":return PURPOSE_TAGS;
  case "hair":return HAIR_CHOICES;
  case "body":return BODY_CHOICES;
 }
}
export function setSearchFilter(f:SearchFilters,key:SearchOptionKey,value:string):SearchFilters{
 const choices=searchOptions(key);
 if(!choices.includes(value))throw Error("SEARCH_OPTION_INVALID");
 const selected=nextSelection("single-optional",f[key]?[f[key]!]:[],value,choices);
 return {...f,[key]:selected[0]??null};
}
export function toggleSearchTag(f:SearchFilters,key:"like"|"love",categoryIndex:number,itemIndex:number):SearchFilters{
 const category=LIKE_CATEGORIES[categoryIndex];
 const tag=category?.items[itemIndex];
 if(!category||!tag)throw Error("SEARCH_TAG_INVALID");
 const current=f[key]?.category===category.name?[f[key]!.tag]:[];
 const selected=nextSelection("single-optional",current,tag,category.items);
 return {...f,[key]:selected.length?{category:category.name,tag:selected[0]!}:null};
}
/** 35 or 35-49, using adopted 18–89 age bounds; blank input never erases prior settings. */
export function parseSearchAge(text:string):{ageMin:number;ageMax:number}{
 const m=/^(\d{1,2})(?:\s*[-〜～]\s*(\d{1,2}))?$/.exec(text.trim());
 if(!m)throw Error("SEARCH_AGE_FORMAT_INVALID");
 const min=Number(m[1]),max=Number(m[2]??m[1]);
 if(min<18||max>89||min>max)throw Error("SEARCH_AGE_RANGE_INVALID");
 return {ageMin:min,ageMax:max};
}
export function validateSearch(f:SearchFilters):SearchFilters{
 if(!["profile","recruitment"].includes(f.kind)||typeof f.keyword!=="string"||
  f.keyword.length>80||/[\u0000-\u001f]/.test(f.keyword)||
  f.region!==null&&!isAreaBlock(f.region)||
  f.position!==null&&!PROFILE_POSITIONS.includes(f.position as typeof PROFILE_POSITIONS[number])||
  f.purpose!==null&&!PURPOSE_TAGS.includes(f.purpose as typeof PURPOSE_TAGS[number])||
  f.hair!==null&&!HAIR_CHOICES.includes(f.hair as typeof HAIR_CHOICES[number])||
  f.body!==null&&!BODY_CHOICES.includes(f.body as typeof BODY_CHOICES[number])||
  (f.ageMin===null)!==(f.ageMax===null)||
  (f.ageMin!==null&&(!Number.isInteger(f.ageMin)||f.ageMin<18||
   !Number.isInteger(f.ageMax)||f.ageMax!>89||f.ageMin>f.ageMax!)))
  throw Error("SEARCH_FILTER_INVALID");
 for(const key of ["like","love"] as const)
  if(f[key]!==null)validLikeTags([f[key]!]);
 return f;
}
export function telegramPublishedMessageUrl(chatId:number,messageId:number):string{
 const c=String(chatId);
 if(!/^-100[1-9]\d+$/.test(c)||!Number.isSafeInteger(messageId)||messageId<1)
  throw Error("SEARCH_PUBLIC_LINK_UNVERIFIED");
 return "https://t.me/c/"+c.slice(4)+"/"+messageId;
}
