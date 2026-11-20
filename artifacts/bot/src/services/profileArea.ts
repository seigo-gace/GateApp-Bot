/** Master-approved profile area catalog from the Area's BBS topic ledger.
 * These are DISPLAY REGIONS, not Telegram message_thread_id values.
 */
export const PROFILE_AREA_CATALOG = {
  "北海道": [
    "北海道"
  ],
  "東北": [
    "青森",
    "秋田",
    "岩手",
    "山形",
    "宮城",
    "福島"
  ],
  "甲信越": [
    "新潟",
    "長野",
    "山梨"
  ],
  "北陸": [
    "富山",
    "石川",
    "福井"
  ],
  "北関東": [
    "群馬",
    "栃木",
    "茨城"
  ],
  "東京": [
    "池袋",
    "新宿",
    "渋谷",
    "品川",
    "都心",
    "区東部",
    "都下"
  ],
  "南関東": [
    "千葉",
    "埼玉",
    "横須賀・湘南・小田原",
    "横浜・川崎",
    "町田・相模原・厚木"
  ],
  "東海": [
    "静岡",
    "愛知",
    "岐阜",
    "三重"
  ],
  "関西": [
    "滋賀",
    "京都",
    "大阪キタ",
    "大阪ミナミ",
    "兵庫",
    "奈良",
    "和歌山"
  ],
  "中国": [
    "鳥取",
    "島根",
    "岡山",
    "広島",
    "山口"
  ],
  "四国": [
    "徳島",
    "香川",
    "愛媛",
    "高知"
  ],
  "九州": [
    "福岡",
    "大分",
    "佐賀",
    "長崎",
    "熊本",
    "宮崎",
    "鹿児島"
  ],
  "沖縄": [
    "沖縄"
  ]
} as const;
export type ProfileAreaBlock=keyof typeof PROFILE_AREA_CATALOG;
export type ProfileAreaValues={region?:ProfileAreaBlock|null;area?:string|null;pendingRegion?:ProfileAreaBlock|null};
export const PROFILE_AREA_BLOCKS=Object.keys(PROFILE_AREA_CATALOG) as ProfileAreaBlock[];
export function isAreaBlock(value:string):value is ProfileAreaBlock{
 return Object.prototype.hasOwnProperty.call(PROFILE_AREA_CATALOG,value);
}
export function areaChildren(block:ProfileAreaBlock):readonly string[]{
 return PROFILE_AREA_CATALOG[block] as readonly string[];
}
export function validateProfileArea(value:ProfileAreaValues):void{
 const {region,area,pendingRegion}=value;
 if(pendingRegion!=null&&!isAreaBlock(pendingRegion))throw Error("PROFILE_PENDING_AREA_BLOCK_INVALID");
 if(region==null){if(area!=null)throw Error("PROFILE_AREA_ORPHAN");return;}
 if(!isAreaBlock(region))throw Error("PROFILE_AREA_BLOCK_INVALID");
 if(area==null||!areaChildren(region).includes(area))throw Error("PROFILE_AREA_CHILD_INVALID");
}
/** Preserve the selected region-child pair or atomically replace both.
 * Clicking the same selected child clears the entire optional area.
 */
export function toggleProfileArea(value:ProfileAreaValues,block:ProfileAreaBlock,child:string):
 {region:ProfileAreaBlock|null;area:string|null;pendingRegion:null}{
 if(!areaChildren(block).includes(child))throw Error("PROFILE_AREA_CHILD_INVALID");
 if(value.region===block&&value.area===child)return {region:null,area:null,pendingRegion:null};
 return {region:block,area:child,pendingRegion:null};
}
/** Return occupies one slot; no blank filler. Prefer 3 columns; use 2 for
 * long names or avoid the one-button trailing row with 4 when appropriate.
 */
export function areaButtonRows(labels:readonly string[],backLabel="↩ 戻る"):string[][]{
 if(!labels.length)throw Error("PROFILE_AREA_EMPTY");
 const n=labels.length+1;
 const long=labels.some(label=>[...label].length>=9);
 const cols=long?2:n%3===1&&n>=7?4:3;
 const entries=[...labels,backLabel];
 const rows:string[][]=[];
 for(let i=0;i<entries.length;i+=cols)rows.push(entries.slice(i,i+cols));
 return rows;
}
