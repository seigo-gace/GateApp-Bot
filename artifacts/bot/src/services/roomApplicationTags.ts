/** ROOM application tags reuse the adopted Profile #Like/#Love category,
 * paging, toggle and HTML-escaped recruitment preview. No own tag catalog.
 */
import {escapeProfileHtml,type ProfileBasicDraft} from "./profileCore.js";
import {
  likeCategoryRows,likeItemRows,validLikeTags,type LikeTag,type ProfileTagPurpose
} from "./profileLike.js";
import {renderRecruitmentPreview,type RecruitmentInput} from "./recruitmentCompose.js";
import {adaptiveChoiceRows} from "./inlineSelection.js";
export {adaptiveChoiceRows as roomChoiceRows} from "./inlineSelection.js";

export type RoomApplicationTags={likeTags?:LikeTag[];loveTags?:LikeTag[]};
export function applicationTagValues(data:RoomApplicationTags,purpose:ProfileTagPurpose):LikeTag[]{
 return validLikeTags(purpose==="like"?data.likeTags??[]:data.loveTags??[]);
}
const callback=(purpose:ProfileTagPurpose,screenId:number,value:string)=>
 value.replace(`pf:${purpose}:${screenId}:`,`application:tag:${purpose}:${screenId}:`);

export function applicationTagRows(
 purpose:ProfileTagPurpose,screenId:number,data:RoomApplicationTags,
 category?:number,page=0
){
 const tags=applicationTagValues(data,purpose);
 const original=category===undefined?
  likeCategoryRows(screenId,tags,purpose):
  likeItemRows(screenId,category,page,tags,purpose);
 const mapped=original.map(row=>row.map(button=>{
  let key=callback(purpose,screenId,button.callback_data);
  if(key.endsWith(":save") || (category===undefined&&key.endsWith(":back")))
   key="application:preview";
  return {text:button.text,callback_data:key};
 }));
 if(category===undefined){
  const categoryButtons=mapped.slice(0,2).flat();
  return [...adaptiveChoiceRows(categoryButtons),mapped[2]!];
 }
 const isCandidate=(key:string)=>{
  const parts=key.split(":");
  return parts.length===7&&parts[0]==="application"&&parts[1]==="tag"&&
   (parts[2]==="like"||parts[2]==="love")&&parts[4]==="tag"&&
   Number.isSafeInteger(Number(parts[3]))&&Number.isSafeInteger(Number(parts[5]))&&
   Number.isSafeInteger(Number(parts[6]));
 };
 const candidates=mapped.filter(row=>row.some(b=>isCandidate(b.callback_data))).flat();
 const other=mapped.filter(row=>!row.some(b=>isCandidate(b.callback_data)));
 const navigation=other.filter(row=>row.some(b=>b.callback_data.includes(":page:")));
 const controls=other.filter(row=>!row.some(b=>b.callback_data.includes(":page:"))).flat();
 // Keep the long "この分類を解除" legible; Save is a permitted single
 // confirmation action, never a stranded candidate.
 const controlsRows=controls.length===3?
  [controls.slice(0,2),controls.slice(2)]:
  controls.length?[controls]:[];
 return [...adaptiveChoiceRows(candidates),...navigation,...controlsRows];
}
export function renderRoomApplicationPreview(
 draft:RecruitmentInput & RoomApplicationTags,
 profile?:ProfileBasicDraft|null
):string{
 const tags=(purpose:ProfileTagPurpose)=>
  applicationTagValues(draft,purpose).map(v=>"#"+escapeProfileHtml(v.tag)).join(" ");
 return renderRecruitmentPreview(draft,profile)+
  "\n\n💖 #Like："+tags("like")+
  "\n💘 #Love："+tags("love");
}
