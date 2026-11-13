/** Shared Room+募集 / ROOM応募 tag choice panels.
 * Only callbacks are owner-specific: the labels, colors, choice paging,
 * selection marks and 4/3/2 grouping must remain identical.
 */
import {styledInlineButton} from "./inlineButtonStyle.js";
import {recruitmentSelectionRows} from "./recruitmentButtonLayout.js";
import {LIKE_CATEGORIES,likePageBounds,validLikeTags,type LikeTag} from "./profileLike.js";

export type RoomTagPanelCallbacks={
 openCategory:(index:number)=>string;
 selectItem:(category:number,index:number)=>string;
 changePage:(category:number,page:number)=>string;
 save:string;back:string;cancel:string;
};

export function roomRecruitmentCategoryRows(c:RoomTagPanelCallbacks){
 const categories=LIKE_CATEGORIES.map((category,index)=>
  styledInlineButton(category.name,c.openCategory(index),"primary"));
 return [categories.slice(0,3),categories.slice(3),[
  styledInlineButton("↩ 戻る",c.back),
  styledInlineButton("キャンセル",c.cancel,"danger"),
 ]];
}
export function roomRecruitmentTagRows(
 category:number,page:number,tags:readonly LikeTag[],c:RoomTagPanelCallbacks,
 purpose:"like"|"love"
){
 const current=validLikeTags(tags);
 const cat=LIKE_CATEGORIES[category];
 if(!cat)throw Error("ROOM_TAG_CATEGORY_INVALID");
 const bounds=likePageBounds(category,page);
 const candidateButtons=cat.items.slice(bounds.start,bounds.end).map((value,i)=>
  styledInlineButton(
   (current.some(t=>t.category===cat.name&&t.tag===value)?"✅ ":"▫️ ")+value,
   c.selectItem(category,bounds.start+i),purpose==="like"?"success":"danger"));
 // The adopted 募集+Room grid is 4/3 columns for ordinary candidate pages.
 // Do not let caption-length heuristics downgrade a 12-tag page to two columns.
 const rows=recruitmentSelectionRows(candidateButtons,true);
 const back=styledInlineButton("↩ 戻る",
  page>0?c.changePage(category,page-1):c.back);
 const save=styledInlineButton("✅ 保存",c.save,"success");
 const cancel=styledInlineButton("キャンセル",c.cancel,"danger");
 const next=page+1<bounds.total
  ?[styledInlineButton("次 ➡️",c.changePage(category,page+1),"primary")]
  :[];
 // Keep page navigation in the shared 3/4-control footer, never in tag rows.
 // Back returns to the preceding page, or to categories on the first page.
 return [...rows,[back,save,cancel,...next]];
}
