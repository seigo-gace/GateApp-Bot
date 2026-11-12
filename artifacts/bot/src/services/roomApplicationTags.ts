/** ROOM application tags reuse the adopted Profile #Like/#Love category,
 * paging, toggle and HTML-escaped recruitment preview. No own tag catalog.
 */
import {escapeProfileHtml,type ProfileBasicDraft} from "./profileCore.js";
import {
  likeCategoryRows,likeItemRows,validLikeTags,type LikeTag,type ProfileTagPurpose
} from "./profileLike.js";
import {renderRecruitmentPreview,type RecruitmentInput} from "./recruitmentCompose.js";

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
 return original.map(row=>row.map(button=>{
  let key=callback(purpose,screenId,button.callback_data);
  if(key.endsWith(":save") || (category===undefined&&key.endsWith(":back")))
   key="application:preview";
  return {text:button.text,callback_data:key};
 }));
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
