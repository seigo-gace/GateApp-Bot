/** Telegram Bot API 10.3 RichTextButton preview.
 * Only a DM screen uses these callbacks; public posts stay plain HTML.
 * When a Telegram client/API doesn't support rich inline buttons, the owner
 * keeps a normal keyboard with the exact same callback handlers.
 */
import type {RecruitmentInput} from "./recruitmentCompose.js";
type RichButton={type:"button";button:{text:string;callback_data:string;style:"link"}};
const edit=(rev:number,field:"title"|"nickname"|"stats"|"body"):RichButton=>({
 type:"button",button:{text:"📝 編集",callback_data:`recruit:edit:${rev}:${field}`,style:"link"},
});
const paragraph=(text:unknown)=>({type:"paragraph",text});
export function buildRecruitmentRichPreview(
 d:RecruitmentInput,revision:number,destination:string,warning?:string,
){
 if(!Number.isSafeInteger(revision)||revision<=0)throw Error("RECRUITMENT_REVISION_INVALID");
 const blocks:unknown[]=[
  paragraph("📢 公開前プレビュー（未投稿）"),
  paragraph([{type:"bold",text:"📢 "+d.title}," ",edit(revision,"title")]),
 ];
 if(d.mode==="manual"){
  blocks.push(paragraph(["ニックネーム："+(d.nickname??"")," ",edit(revision,"nickname")]));
  blocks.push(paragraph([
   d.heightCm+"cm | "+d.weightKg+"kg | "+d.age+"歳"," ",edit(revision,"stats"),
  ]));
 }
 blocks.push({type:"divider"});
 blocks.push(paragraph([{type:"bold",text:"募集内容"}," ",edit(revision,"body")]));
 blocks.push(paragraph(d.body));
 if(d.mode==="linked")blocks.push(paragraph("プロフィール：保存済みの共通原本と連動"));
 if(d.purposeCodes.length)blocks.push(paragraph("🎯 目的："+d.purposeCodes.map(v=>"#"+v).join(" ")));
 if(d.placeCodes.length)blocks.push(paragraph("📍 場所："+d.placeCodes.map(v=>"#"+v).join(" ")));
 blocks.push(paragraph(destination));
 blocks.push(paragraph("📝 編集しても他の入力・選択は保持します。"));
 if(warning)blocks.push(paragraph(warning));
 return {blocks};
}
