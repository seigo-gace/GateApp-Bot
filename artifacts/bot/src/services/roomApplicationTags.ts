/** ROOM応募 uses the *same* Room+募集 tag choice panels and profile tag
 * dictionary/toggle rules. Only callback namespace and draft storage differ.
 */
import {escapeProfileHtml,type ProfileBasicDraft} from "./profileCore.js";
import {validLikeTags,type LikeTag,type ProfileTagPurpose} from "./profileLike.js";
import {renderRecruitmentPreview,type RecruitmentInput} from "./recruitmentCompose.js";
import {roomRecruitmentCategoryRows,roomRecruitmentTagRows} from "./roomRecruitmentTagPanels.js";
export {adaptiveChoiceRows as roomChoiceRows} from "./inlineSelection.js";

export type RoomApplicationTags={likeTags?:LikeTag[];loveTags?:LikeTag[]};
export function applicationTagValues(data:RoomApplicationTags,purpose:ProfileTagPurpose):LikeTag[]{
 return validLikeTags(purpose==="like"?data.likeTags??[]:data.loveTags??[]);
}
export function applicationTagRows(
 purpose:ProfileTagPurpose,screenId:number,data:RoomApplicationTags,
 category?:number,page=0
){
 const prefix=`application:tag:${purpose}:${screenId}`;
 const callbacks={
  openCategory:(index:number)=>`${prefix}:open:${index}`,
  selectItem:(cat:number,index:number)=>`${prefix}:tag:${cat}:${index}`,
  changePage:(cat:number,next:number)=>`${prefix}:page:${cat}:${next}`,
  save:"application:preview",back:`${prefix}:back`,cancel:"application:cancel",
 };
 if(category===undefined)return roomRecruitmentCategoryRows({
  ...callbacks,back:"application:preview",
 });
 return roomRecruitmentTagRows(category,page,applicationTagValues(data,purpose),callbacks);
}
export function renderRoomApplicationPreview(
 draft:RecruitmentInput & RoomApplicationTags,
 profile?:ProfileBasicDraft|null
):string{
 const tags=(purpose:ProfileTagPurpose)=>
  applicationTagValues(draft,purpose).map(v=>"#"+escapeProfileHtml(v.tag)).join(" ");
 return renderRecruitmentPreview(draft,profile)+
  "\n#Like："+tags("like")+"\n#Love："+tags("love");
}
