/** Source-of-truth hierarchy for private recruitment destination picking.
 * Names are display-only: never interpret a t.me message URL as a Telegram thread ID.
 * Selectable targets always come from the separately verified posting_topics DB.
 */
import {AREA_BLOCKS,CATEGORY_TOPICS} from "./topicBoardContent.js";
import {BOARD_TITLES,type BoardKey,type VerifiedTopic} from "./topicRouting.js";

export const RECRUITMENT_GROUPS=["area_bbs","gay_board","video_chat"] as const satisfies readonly BoardKey[];
export function recruitmentGroups(topics:readonly VerifiedTopic[]){
 return RECRUITMENT_GROUPS.filter(board=>topics.some(t=>t.board===board))
  .map(board=>({board,label:BOARD_TITLES[board]}));
}
const normalize=(value:string)=>value.normalize("NFKC").replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Variation_Selector}\u200d]/gu,"")
 .replace(/[\s・/／_()（）\[\]【】]/g,"").toLowerCase();
export function recruitmentAreaBlockOptions(topics:readonly VerifiedTopic[]){
 const areas=topics.filter(t=>t.board==="area_bbs");
 const matched=new Set<number>();
 const groups=AREA_BLOCKS.map((block,index)=>{
  const entries=areas.filter(t=>block.children.some(c=>normalize(t.title).includes(normalize(c.label))));
  entries.forEach(t=>matched.add(t.id));
  return {index,label:block.label,topics:entries};
 }).filter(block=>block.topics.length>0);
 const remainder=areas.filter(t=>!matched.has(t.id));
 if(remainder.length)groups.push({index:AREA_BLOCKS.length,label:"その他の登録済みエリア",topics:remainder});
 return groups;
}
export function recruitmentTopicsForAreaBlock(topics:readonly VerifiedTopic[],index:number){
 const group=recruitmentAreaBlockOptions(topics).find(b=>b.index===index);
 if(!group)throw Error("RECRUITMENT_AREA_BLOCK_NOT_VERIFIED");
 return group.topics;
}
export function recruitmentTopicsForGroup(topics:readonly VerifiedTopic[],board:BoardKey){
 if(board==="area_bbs")throw Error("RECRUITMENT_AREA_BLOCK_REQUIRED");
 const listed=topics.filter(t=>t.board===board);
 const order=board==="gay_board"?CATEGORY_TOPICS.map(t=>normalize(t.label)):[];
 return listed.sort((a,b)=>{
  const ai=order.findIndex(x=>normalize(a.title).includes(x));
  const bi=order.findIndex(x=>normalize(b.title).includes(x));
  return (ai<0?999:ai)-(bi<0?999:bi)||a.title.localeCompare(b.title,"ja");
 });
}
