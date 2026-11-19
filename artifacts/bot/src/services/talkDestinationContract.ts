/** Single source of the three existing talk topic destinations. These visible
 * labels, their order, and topic IDs are Master-owned and must not change.
 * Gate may read this contract but must never mint a new admission flow.
 */
export const TALK_TOPICS=[
 {label:"エリア’s BBS",url:"https://t.me/c/3847210571/44",chatId:-1003847210571},
 {label:"ビデオChatの掲示板",url:"https://t.me/c/2373696859/4291",chatId:-1002373696859},
 {label:"ゲイのための掲示板♂",url:"https://t.me/c/3770334893/789",chatId:-1003770334893},
] as const;
export function talkDestination(index:number|undefined|null){
 return Number.isInteger(index)&&index!==undefined&&index!==null
  ?TALK_TOPICS[index]??null:null;
}
