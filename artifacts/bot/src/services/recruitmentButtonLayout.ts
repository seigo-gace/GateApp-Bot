import {styledInlineButton} from "./inlineButtonStyle.js";
/** Group recruitment choices: default three columns; a short group may use four. */
export function recruitmentDecisionRow(revision:number){
 if(!Number.isSafeInteger(revision)||revision<=0)throw Error("RECRUITMENT_REVISION_INVALID");
 return [
  {text:"✅ 投稿する",callback_data:`recruit:post:${revision}`,style:"success" as const},
  {text:"キャンセル",callback_data:`recruit:cancel:${revision}`},
 ];
}
export function recruitmentSelectionRows<T>(items:readonly T[],allowFour=false):T[][] {
 const out:T[][]=[];
 for(let i=0;i<items.length;){
  const n=items.length-i;
  const take=n===4?(allowFour?4:2):Math.min(3,n);
  out.push(items.slice(i,i+take) as T[]);
  i+=take;
 }
 return out;
}

/** One canonical selector row shared by Room+募集 and ROOM応募.
 * The caller owns callback namespace and persistence; layout/styles are shared.
 */
export function roomRecruitmentSelectorRow(
 mode:"manual"|"linked",
 selectedPosition:boolean,
 callbacks:{position:string;like:string;love:string},
){
 const b=styledInlineButton;
 return [
  ...(mode==="manual"?[b(selectedPosition?"✅ ポジション":"ポジション選択",callbacks.position,"primary")]:[]),
  b("#Like",callbacks.like,"success"),
  b("#Love",callbacks.love,"danger"),
 ];
}
