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
 const navigation=[];
 if(page>0)navigation.push(styledInlineButton("◀ 前へ",c.changePage(category,page-1)));
 if(page+1<bounds.total)navigation.push(styledInlineButton("次へ ▶",c.changePage(category,page+1)));
 const save=styledInlineButton("✅ 保存",c.save,"success");
 const back=styledInlineButton("↩ 戻る",c.back);
 const cancel=styledInlineButton("キャンセル",c.cancel,"danger");
 // Footer is always the same three controls, in the Master-approved order.
 // Place a lone page arrow alongside candidates instead of on its own row.
 if(navigation.length===1){
  const last=rows[rows.length-1];
  if(!last)throw Error("ROOM_TAG_EMPTY_PAGE");
  if(last.length<4)last.push(navigation[0]!);
  else {
   const moved=last.pop()!;
   rows.push([moved,navigation[0]!]);
  }
 }else if(navigation.length===2)rows.push(navigation);
 return [...rows,[back,save,cancel]];
}
