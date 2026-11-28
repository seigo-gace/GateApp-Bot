/** Shared profile/recruitment appearance panel. The caller owns the draft and save. */
import {Markup} from "telegraf";
import {selectionRows} from "./inlineSelection.js";
import {HAIR_CHOICES,BODY_CHOICES,HAIR_ROWS,BODY_ROWS,type AppearanceValues} from "./profileAppearance.js";
import {PROFILE_AREA_BLOCKS,areaChildren,areaButtonRows,type ProfileAreaValues,type ProfileAreaBlock} from "./profileArea.js";
type AppearanceData=AppearanceValues&ProfileAreaValues;
type Namespace="pf"|"ra";
const saveSectionButton=(rev:number,ns:Namespace)=>Markup.button.callback("保存",`${ns}:section:${rev}:save`);
export const appearanceKeyboard=(revision:number,ns:Namespace="pf")=>Markup.inlineKeyboard([
 [
  Markup.button.callback("髪型",`${ns}:ap:${revision}:open:h`),
  Markup.button.callback("体型",`${ns}:ap:${revision}:open:b`),
  Markup.button.callback("エリア",`${ns}:ap:${revision}:area`),
  Markup.button.callback("戻る",`${ns}:ap:${revision}:back`),
 ],
 [saveSectionButton(revision,ns)],
]);
export const appearanceText=(data:AppearanceData,ns:Namespace="pf")=>[
  ns==="pf"?"🪪 プロフィール｜容姿/エリア":"📢 相手募集｜容姿/エリア",
  "髪型："+(data.hair||"未設定"),
  "体型："+(data.body||"未設定"),
  "エリア："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
  "",
  "髪型・体型・エリアは任意です。変更したい項目を選んでください。",
  ns==="pf"?"［戻る］でプロフィール一覧へ。［保存］は①〜⑤をまとめて非公開保存します。":"［戻る］または［保存］で相手募集へ。投稿は行いません。",
].join("\n");
export const choiceKeyboard=(kind:"h"|"b",revision:number,data:AppearanceData,ns:Namespace="pf")=>{
 const rows=kind==="h"
  ?selectionRows(HAIR_ROWS,data.hair?[data.hair]:[],
    v=>`${ns}:ap:${revision}:h:${HAIR_CHOICES.indexOf(v)}`)
  :selectionRows(BODY_ROWS,data.body?[data.body]:[],
    v=>`${ns}:ap:${revision}:b:${BODY_CHOICES.indexOf(v)}`);
 const styled=rows.map(row=>row.map(b=>({
   ...Markup.button.callback(b.text,b.callback_data),
   style:kind==="h"?"primary" as const:"success" as const,
 })));
 return Markup.inlineKeyboard([
   ...styled.slice(0,-1),
   [...styled[styled.length-1]!,
    Markup.button.callback("↩ 戻る",`${ns}:ap:${revision}:back`)],
   [saveSectionButton(revision,ns)],
 ]);
};
export const choiceText=(kind:"h"|"b",data:AppearanceData,ns:Namespace="pf")=>
  [
    kind==="h"?"💈 髪型を選択してください":"💪 体型を選択してください",
    "現在："+(kind==="h"?(data.hair||"未設定"):(data.body||"未設定")),
    "任意で1つ選択。✅選択中／▫️未選択。同じ候補で解除できます。",
    ns==="pf"?"［↩ 戻る］で容姿/エリアの一覧へ。［保存］は①〜⑤すべてを非公開で保存します。":"［↩ 戻る］で容姿/エリアの一覧へ。［保存］で相手募集に戻ります。",
  ].join("\n");

/** Region IDs are independent of any Telegram topic IDs or deep links. */
export const areaBlocksKeyboard=(revision:number,data:AppearanceData,ns:Namespace="pf")=>{
 const rows=areaButtonRows(PROFILE_AREA_BLOCKS,"↩ 戻る");
 return Markup.inlineKeyboard([
 ...rows.map(row=>row.map(label=>{
  if(label==="↩ 戻る")return Markup.button.callback(label,`${ns}:ar:${revision}:back`);
  const index=PROFILE_AREA_BLOCKS.indexOf(label as ProfileAreaBlock);
  const checked=data.region===label&&data.area!=null;
  return Markup.button.callback((checked?"✅ ":"▫️ ")+label,
   `${ns}:ar:${revision}:r:${index}`);
 })),[saveSectionButton(revision,ns)],
 ]);
};
export const areaBlocksText=(data:AppearanceData,ns:Namespace="pf")=>[
 "📍 エリアを選択してください",
 "現在："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
 "全国13ブロックから地域を選び、その中のエリアを1つ選択してください。",
 "北海道・沖縄は直接選択・解除できます。別の地域を見るだけでは現在の選択は消えません。",
 ns==="pf"?"✅選択中／▫️未選択。［↩ 戻る］で容姿/エリアの一覧へ。［保存］で全項目を非公開保存します。":"✅選択中／▫️未選択。［↩ 戻る］で容姿/エリアへ。［保存］で相手募集へ。",
].join("\n");
export const areaChildrenKeyboard=(revision:number,data:AppearanceData,ns:Namespace="pf")=>{
 const block=data.pendingRegion;
 if(!block)throw Error("PROFILE_AREA_BLOCK_MISSING");
 const options=areaChildren(block);
 return Markup.inlineKeyboard([
 ...areaButtonRows(options).map(row=>row.map(label=>{
  if(label==="↩ 戻る")return Markup.button.callback(label,`${ns}:ar:${revision}:back`);
  const index=options.indexOf(label);
  return Markup.button.callback((data.region===block&&data.area===label?"✅ ":"▫️ ")+label,
   `${ns}:ar:${revision}:a:${index}`);
 })),[saveSectionButton(revision,ns)],
 ]);
};
export const areaChildrenText=(data:AppearanceData,ns:Namespace="pf")=>[
 "📍 "+data.pendingRegion+"｜エリアを選択",
 "現在："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
 "エリアを1つ選択してください。✅選択中／▫️未選択。同じエリアの再押下で解除、別候補で変更できます。",
 ns==="pf"?"［↩ 戻る］で全国13ブロックへ。［保存］で全項目を非公開保存します。":"［↩ 戻る］で全国13ブロックへ。［保存］で相手募集へ。",
].join("\n");

