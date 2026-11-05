import {nextSelection,selectionRows} from "./inlineSelection.js";

/** Original Notion04 labels and order. Purpose is supplied by the owning profile handler. */
export const LIKE_CATEGORIES = [
  {
    "name": "エロワード",
    "items": [
      "変態",
      "ド変態",
      "生交尾",
      "淫乱",
      "ド淫乱",
      "ドスケベ",
      "ガッツリ",
      "汗だく",
      "アへ顔",
      "淫語",
      "モロ感"
    ]
  },
  {
    "name": "パーツ",
    "items": [
      "乳首",
      "ペニス",
      "デカマラ",
      "ドリチン",
      "包茎",
      "ズルムケ",
      "亀頭",
      "アナル",
      "首",
      "頭",
      "背中",
      "胸筋",
      "腹筋",
      "お尻",
      "足",
      "ふともも",
      "腕",
      "二の腕",
      "胸毛",
      "毛深い",
      "体毛薄い",
      "パイパン"
    ]
  },
  {
    "name": "プレイ",
    "items": [
      "やり目",
      "即やり",
      "エロ友",
      "飲み/飯",
      "旅行",
      "言葉攻め",
      "SM",
      "ドS",
      "ドM",
      "調教",
      "拘束",
      "目隠し",
      "縛られたい[緊縛]",
      "縛りたい[緊縛]",
      "廻したい",
      "廻されたい",
      "攻めたい",
      "攻められたい",
      "攻め合い",
      "掘りたい",
      "掘られたい",
      "掘り合い",
      "ケツなし",
      "バニラ",
      "イチャイチャ",
      "サシ",
      "3p/4p",
      "複数",
      "乱交",
      "見せ合い",
      "露出/野外",
      "ハッテン場",
      "目隠し待機",
      "場所あり",
      "場所なし",
      "移動可",
      "足あり",
      "キス",
      "フェラ",
      "イマラチオ",
      "ガン掘り",
      "タフマン",
      "種付け",
      "電マ",
      "玩具",
      "張り型",
      "ディルド",
      "亀頭責め",
      "乳首責め",
      "フィスト",
      "二本挿し",
      "三連結",
      "スカトロ",
      "ション浣"
    ]
  },
  {
    "name": "雰囲気/外見",
    "items": [
      "年上好き",
      "老け専",
      "年下好き",
      "同年代",
      "若専",
      "誰専",
      "デブ専",
      "細専",
      "ガタイ専",
      "チビ専",
      "イカニモ系",
      "イモ系",
      "リーマン",
      "体育会系",
      "兄貴系",
      "ヤンチャ系",
      "イカツイ系",
      "ウルフ系",
      "コング系",
      "犬顔",
      "猿顔",
      "猫顔",
      "女装",
      "NH",
      "男の娘"
    ]
  },
  {
    "name": "着衣/装備",
    "items": [
      "コックリング",
      "ケツワレ",
      "競パン",
      "六尺",
      "ラグパン",
      "シングレット",
      "エロ下着",
      "スポユニ",
      "スーツ",
      "制服",
      "作業着",
      "ハーネス",
      "全頭マスク",
      "犬マスク",
      "アイマスク",
      "拘束具"
    ]
  },
  {
    "name": "性感帯",
    "items": [
      "乳首",
      "ペニス",
      "亀頭",
      "アナル",
      "口",
      "耳",
      "首",
      "胸",
      "お腹",
      "お尻",
      "足",
      "腕"
    ]
  }
] as const;
export type LikeTag = {category:string;tag:string};
export type ProfileTagPurpose="like"|"love";
export const tagPurposeDescription=(purpose:ProfileTagPurpose)=>purpose==="like"
 ? "自分についての特徴・好み・趣味・スタイルを選択してください。"
 : "相手に求める特徴・好み・趣味・スタイルを選択してください。";
export const LIKE_PAGE_SIZE=12;
export function validLikeTags(tags:readonly LikeTag[]):LikeTag[]{
 if(!Array.isArray(tags))throw Error("PROFILE_LIKE_INVALID");
 const keys=new Set<string>();
 return tags.map(t=>{
  if(!t||typeof t.category!=="string"||typeof t.tag!=="string")throw Error("PROFILE_LIKE_INVALID");
  const cat=LIKE_CATEGORIES.find(c=>c.name===t.category);
  if(!cat||!(cat.items as readonly string[]).includes(t.tag))throw Error("PROFILE_LIKE_INVALID");
  const k=JSON.stringify([t.category,t.tag]);
  if(keys.has(k))throw Error("PROFILE_LIKE_DUPLICATE");
  keys.add(k);return {category:t.category,tag:t.tag};
 });
}
export function toggleLike(tags:readonly LikeTag[],category:number,index:number):LikeTag[]{
 const cat=LIKE_CATEGORIES[category];
 if(!cat||!Number.isInteger(index)||index<0||index>=cat.items.length)throw Error("PROFILE_LIKE_INVALID");
 const old=validLikeTags(tags);
 const current=old.filter(t=>t.category===cat.name).map(t=>t.tag);
 const next=nextSelection("multiple",current,cat.items[index],cat.items);
 return [...old.filter(t=>t.category!==cat.name),...next.map(tag=>({category:cat.name,tag}))];
}
export function likeCategoryRows(revision:number,tags:readonly LikeTag[],purpose:ProfileTagPurpose="like"){
 const checked=validLikeTags(tags);
 const r=LIKE_CATEGORIES.map((c,i)=>({
  text:c.name+(checked.some(t=>t.category===c.name)?" ("+checked.filter(t=>t.category===c.name).length+")":""),
  callback_data:`pf:${purpose}:${revision}:open:${i}`,
 }));
 return [[...r.slice(0,3)],[...r.slice(3,6)],[
  {text:"↩ 戻る",callback_data:`pf:${purpose}:${revision}:back`},
  {text:"保存",callback_data:`pf:${purpose}:${revision}:save`}
 ]];
}
export function likeItemRows(revision:number,category:number,page:number,tags:readonly LikeTag[],purpose:ProfileTagPurpose="like"){
 const c=LIKE_CATEGORIES[category];
 if(!c||!Number.isInteger(page)||page<0||page>=Math.ceil(c.items.length/LIKE_PAGE_SIZE))
  throw Error("PROFILE_LIKE_PAGE_INVALID");
 const selected=validLikeTags(tags).filter(t=>t.category===c.name).map(t=>t.tag);
 const start=page*LIKE_PAGE_SIZE,values=c.items.slice(start,start+LIKE_PAGE_SIZE);
 const chunks: string[][]=[];
 for(let i=0;i<values.length;i+=3)chunks.push([...values.slice(i,i+3)]);
 const rows=selectionRows(chunks,selected,
   v=>`pf:${purpose}:${revision}:tag:${category}:${c.items.indexOf(v)}`);
 const total=Math.ceil(c.items.length/LIKE_PAGE_SIZE);
 if(total>1)rows.push([
  {text:"◀ 前へ",callback_data:`pf:${purpose}:${revision}:page:${category}:${page-1}`},
  {text:"次へ ▶",callback_data:`pf:${purpose}:${revision}:page:${category}:${page+1}`},
 ]);
 rows.push([
  {text:"↩ 戻る",callback_data:`pf:${purpose}:${revision}:back`},
  {text:"この分類を解除",callback_data:`pf:${purpose}:${revision}:clear:${category}`},
  {text:"保存",callback_data:`pf:${purpose}:${revision}:save`},
 ]);
 return rows;
}
