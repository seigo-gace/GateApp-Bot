/** Telegram Bot API 10.3 RichTextButton preview.
 * Only a DM screen uses these callbacks; public posts stay plain HTML.
 * When a Telegram client/API doesn't support rich inline buttons, the owner
 * keeps a normal keyboard with the exact same callback handlers.
 */
import type {RecruitmentInput} from "./recruitmentCompose.js";
import type {ProfileBasicDraft} from "./profileCore.js";
type RichButton={type:"button";button:{text:string;callback_data:string;style:"link"}};
const edit=(rev:number,field:"title"|"nickname"|"stats"|"body"):RichButton=>({
 type:"button",button:{text:"📝 編集",callback_data:`recruit:edit:${rev}:${field}`,style:"link"},
});
const paragraph=(text:unknown)=>({type:"paragraph",text});
export function buildRecruitmentRichPreview(
 d:RecruitmentInput,revision:number,destination:string,warning?:string,profile?:ProfileBasicDraft|null,published=false,
){
 if(!Number.isSafeInteger(revision)||revision<=0)throw Error("RECRUITMENT_REVISION_INVALID");
 const blocks:unknown[]=[
  ...destination.split("\n").filter(Boolean).map(paragraph),
  paragraph([{type:"bold",text:"📢 "+d.title}," ",edit(revision,"title")]),
 ];
 if(d.mode==="manual"){
  blocks.push(paragraph(["ニックネーム："+(d.nickname??"")," ",edit(revision,"nickname")]));
  blocks.push(paragraph([
   [d.heightCm+"cm",d.weightKg+"kg",d.age+"歳",d.position??""].filter(Boolean).join(" | "),
   " ",edit(revision,"stats"),
  ]));
 }
 blocks.push({type:"divider"});
 blocks.push(paragraph([{type:"bold",text:"募集内容"}," ",edit(revision,"body")]));
 for(const line of d.body.split("\n"))blocks.push(paragraph(line));
 if(d.mode==="linked"&&profile){
  blocks.push(paragraph("🪪 "+profile.nickname));
  blocks.push(paragraph(profile.heightCm+"cm | "+profile.weightKg+"kg | "+profile.age+"歳 | "+(profile.position??"")));
 }
 if(d.purposeCodes.length)blocks.push(paragraph("🎯 目的："+d.purposeCodes.map(v=>"#"+v).join(" ")));
 if(d.placeCodes.length)blocks.push(paragraph("📍 場所："+d.placeCodes.map(v=>"#"+v).join(" ")));
 blocks.push(paragraph(published?"📢 公開済み募集を編集中":"📢 相手募集（未投稿）"));
 blocks.push(paragraph("📝 編集しても他の入力・選択は保持します。"));
 if(warning)blocks.push(paragraph(warning));
 return {blocks};
}
