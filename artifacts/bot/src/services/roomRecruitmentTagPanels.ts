/** Shared Room+募集 / ROOM応募 tag choice panels.
 * Only callbacks are owner-specific: the labels, colors, choice paging,
 * selection marks and 4/3/2 grouping must remain identical.
 */
import {styledInlineButton} from "./inlineButtonStyle.js";
import {adaptiveChoiceRows} from "./inlineSelection.js";
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
 category:number,page:number,tags:readonly LikeTag[],c:RoomTagPanelCallbacks
){
 const current=validLikeTags(tags);
 const cat=LIKE_CATEGORIES[category];
 if(!cat)throw Error("ROOM_TAG_CATEGORY_INVALID");
 const bounds=likePageBounds(category,page);
 const candidateButtons=cat.items.slice(bounds.start,bounds.end).map((value,i)=>
  styledInlineButton(
   (current.some(t=>t.category===cat.name&&t.tag===value)?"✅ ":"▫️ ")+value,
   c.selectItem(category,bounds.start+i),"success"));
 const rows=adaptiveChoiceRows(candidateButtons);
 const navigation=[];
 if(page>0)navigation.push(styledInlineButton("◀ 前へ",c.changePage(category,page-1)));
 if(page+1<bounds.total)navigation.push(styledInlineButton("次へ ▶",c.changePage(category,page+1)));
 const save=styledInlineButton("✅ 保存",c.save,"success");
 const back=styledInlineButton("↩ 戻る",c.back);
 const cancel=styledInlineButton("キャンセル",c.cancel);
 // Use the original 募集+Room footer. When only one page arrow exists,
 // pair it with Back; never strand a single page-navigation button.
 if(navigation.length===1)return [...rows,[navigation[0]!,back],[save,cancel]];
 return [...rows,...(navigation.length?[navigation]:[]),[save,back],[cancel]];
}
