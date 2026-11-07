/** ONLINE ROOM four-card board, as adopted in Notion 19 on 2026-10-29.
 * This is a publication PREPARATION CONTRACT, NOT a Telegram send.
 * Each card needs its own untouched Drive image asset and one URL button.
 * The three outward links must be existing Gate Bot START URLs, never raw
 * t.me/c links, so membership/approval can be checked in Bot DM.
 */
export type OnlineCardKey="intro"|"area_bbs"|"video_chat"|"gay_board";
export type OnlineCard={
 key:OnlineCardKey;
 image:{driveFileId:string;filename:string;originalName:string};
 caption:string;
 button:{text:string;url:string};
 historicalTarget:string;
};
export type OnlineGateLink={
 group:"area_bbs"|"video_chat"|"gay_board";
 gateStartUrl:string;
 verified:boolean;
};
const MEDIA:Readonly<Record<OnlineCardKey,OnlineCard["image"]>>={
 intro:{driveFileId:"1XGXbjGOEBsYRF4nZ4mOojRHsoD6YLm1W",filename:"00_ONLINE案内_1080.jpg",originalName:"1394.jpg"},
 area_bbs:{driveFileId:"1KZgfk8WlkUnFBbuLxQ5-fjezYO7oFCZu",filename:"01_エリアsBBS_1080.png",originalName:"1375.png"},
 video_chat:{driveFileId:"1jf-7v4xxeJSOggF-lMQ7AEc7TDkWydrM",filename:"02_ビデオChat_1080.jpg",originalName:"1367.jpg"},
 gay_board:{driveFileId:"1hdR5hr_u7A_AK6kS2f_QVj_1YisGrxj9",filename:"03_ゲイ掲示板_1080.jpg",originalName:"1392.jpg"},
};
export const ONLINE_MEDIA=MEDIA;
/** Historical anchors are evidence, NOT eligible public buttons after the
 * later decision requiring Gate Bot START.
 */
export const ONLINE_HISTORICAL_TARGETS={
 intro:"https://t.me/c/3847210571/43",
 area_bbs:"https://t.me/c/3847210571/116",
 video_chat:"https://t.me/c/2373696859/1605",
 gay_board:"https://t.me/c/3770334893/4",
} as const;
export const ONLINE_TOPIC_LEDGER_URL="https://t.me/c/3847210571/1000";
export const ONLINE_CARD_ORDER=["intro","area_bbs","video_chat","gay_board"] as const;
const CAPTIONS:Readonly<Record<OnlineCardKey,string>>={
 intro:"🎬 ビデオChat ROOMのご案内\n\nビデオChat ROOMは、今すぐの開催も日時を決めた予告もできます。プロフィールと連動した開催案内や参加者募集を投稿できます。\n\n下の3つの掲示板から希望する場所へ進み、投稿メニューで募集内容と開催先を確認してから公開してください。参加したい方も各掲示板から案内を探せます。",
 area_bbs:"エリア’s BBS｜ビデオChat ROOM\n\nエリア’s BBSでROOMの開催案内・予告・参加者募集を探せます。投稿したい場合は、専用掲示板の投稿メニューから内容と投稿先を確認してください。",
 video_chat:"ビデオ👀Chat掲示板｜ビデオChat ROOM\n\nビデオChatの開催案内や参加者募集を確認する専用掲示板です。ROOMの開催や募集の投稿は、移動先の投稿メニューから進めてください。",
 gay_board:"🆕ゲイのための掲示板♂｜ビデオChat ROOM\n\n見せ合いなど目的に合う相手を探す掲示板へ案内します。ROOMを使った交流・募集の投稿可否は、移動先の投稿メニューで確認してください。",
};
export function validateOnlineGateStart(link:OnlineGateLink):void{
 if(!link.verified)throw new Error("ONLINE_GATE_LINK_NOT_VERIFIED");
 // Actual username must come from the existing running GATE Bot registry,
 // not synthesized from a guessed display name. Start payload is opaque.
 if(!/^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\?start=[A-Za-z0-9_-]{1,64}$/.test(link.gateStartUrl))
  throw new Error("ONLINE_GATE_START_URL_INVALID");
}
export function renderOnlineRoomCards(links:readonly OnlineGateLink[]):readonly OnlineCard[]{
 if(links.length!==3)throw new Error("ONLINE_GATE_LINKS_INCOMPLETE");
 const byGroup=new Map<OnlineGateLink["group"],OnlineGateLink>();
 for(const link of links){
  validateOnlineGateStart(link);
  if(byGroup.has(link.group))throw new Error("ONLINE_GATE_LINK_DUPLICATE");
  byGroup.set(link.group,link);
 }
 for(const key of ["area_bbs","video_chat","gay_board"] as const)
  if(!byGroup.has(key))throw new Error("ONLINE_GATE_LINK_MISSING:"+key);
 const cards:OnlineCard[]=ONLINE_CARD_ORDER.map(key=>({
  key,
  image:MEDIA[key],
  caption:CAPTIONS[key],
  button:key==="intro"?
   {text:"↩ 総合案内へ戻る",url:ONLINE_HISTORICAL_TARGETS.intro}:
   {text:"🎬 ROOM掲示板へ",url:byGroup.get(key)!.gateStartUrl},
  historicalTarget:ONLINE_HISTORICAL_TARGETS[key],
 }));
 for(const c of cards){
  // Single-card photo caption must stay within Telegram's 1024-character cap.
  if(c.caption.length>1024)throw new Error("ONLINE_CAPTION_TOO_LONG:"+c.key);
 }
 return cards;
}
/** Verify the immutable media bytes against the official Drive inventory at
 * deployment time. A Drive FILE ID is never itself a Telegram sendPhoto ID.
 */
