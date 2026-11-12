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

/** Telegram InlineKeyboard has no fixed-width guarantee. Choose 4/3/2
 * only where the *longest* button caption fits an estimated shared row.
 * Never leave a lone candidate button when at least two candidates exist.
 * Navigation and confirmation controls are never mixed into candidate rows.
 */
export function roomChoiceRows<T extends {text:string}>(items:readonly T[]):T[][]{
 if(items.length===0)return [];
 if(items.length===1)return [[items[0]!]];
 const longest=Math.max(...items.map(x=>Array.from(x.text).reduce(
  (sum,ch)=>sum+(/[\u0000-\u007f]/.test(ch)?1:2),0)));
 const maxColumns=longest<=6?4:longest<=10?3:2;
 const rows:T[][]=[];
 let remaining=items.length,offset=0;
 while(remaining>0){
  let take=Math.min(maxColumns,remaining);
  if(remaining-take===1){
   if(take>2)take--;
   else if(rows.length>0){
    // Put the last candidate next to the preceding row, never alone.
    rows[rows.length-1]!.push(...items.slice(offset));
    return rows;
   }
  }
  rows.push(items.slice(offset,offset+take) as T[]);
  offset+=take;remaining-=take;
 }
 return rows;
}
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
  return [...roomChoiceRows(categoryButtons),mapped[2]!];
 }
 const candidates=mapped.filter(row=>row.some(b=>b.callback_data.includes(":tag:"))).flat();
 const other=mapped.filter(row=>!row.some(b=>b.callback_data.includes(":tag:")));
 const navigation=other.filter(row=>row.some(b=>b.callback_data.includes(":page:")));
 const controls=other.filter(row=>!row.some(b=>b.callback_data.includes(":page:"))).flat();
 // Keep the long "この分類を解除" legible; Save is a permitted single
 // confirmation action, never a stranded candidate.
 return [...roomChoiceRows(candidates),...navigation,
  controls.length===3?[controls.slice(0,2),controls.slice(2)]:controls.length?[controls]:[]
 ].flatMap(row=>Array.isArray(row[0])?row as (typeof controls)[]:[row as typeof controls]);
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
