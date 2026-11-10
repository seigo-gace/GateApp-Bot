/** Single-message recruitment editor. A profile is read-only when linked.
 * The final input field consumes ALL remaining lines, including newlines.
 */
import {parseProfileBasic,escapeProfileHtml,isProfilePosition} from "./profileCore.js";
import type {ProfileBasicDraft} from "./profileCore.js";
import {validateAnnouncementTags} from "./announcementTags.js";
export type RecruitmentInput={
 title:string;body:string;mode:"linked"|"manual";
 nickname?:string;heightCm?:number;weightKg?:number;age?:number;position?:string;
 purposeCodes:string[];placeCodes:string[];
};
/** The selector panel opened before first input still belongs to the text-entry phase.
 * A selector opened from preview must not re-consume arbitrary new text.
 */
export function recruitmentTextPhase(
 step:string, panelReturnStep:unknown,
):"initial"|"edit"|null{
 if(step==="awaiting_text")return "initial";
 if(step==="awaiting_recruitment_edit")return "edit";
 if(step==="awaiting_tags"&&panelReturnStep==="awaiting_text")return "initial";
 return null;
}
export function parseRecruitmentMessage(text:string,hasProfile:boolean):RecruitmentInput{
 const lines=text.replace(/\r\n/g,"\n").split("\n");
 const min=hasProfile?2:4;
 if(lines.length<min)throw Error(hasProfile?
  "1行目タイトル、2行目以降に募集内容を入力してください。":
  "1行目タイトル、2行目ニックネーム、3行目身長 体重 年齢、4行目以降に募集内容を入力してください。");
 const title=lines[0]!.trim();
 const body=lines.slice(hasProfile?1:3).join("\n").trim();
 if(!title||title.length>100)throw Error("タイトルは1〜100文字で入力してください。");
 if(!body||body.length>3000)throw Error("募集内容は1〜3000文字で入力してください。");
 if(hasProfile)return {title,body,mode:"linked",purposeCodes:[],placeCodes:[]};
 const basic=parseProfileBasic(lines[1]+"\n"+lines[2]);
 return {title,body,mode:"manual",...basic,purposeCodes:[],placeCodes:[]};
}
export function changeRecruitmentField(
 current:RecruitmentInput,field:"title"|"nickname"|"stats"|"body",value:string,
):RecruitmentInput{
 if(field==="title"){
  const title=value.trim();
  if(!title||title.length>100||title.includes("\n"))throw Error("タイトルは1行・100文字以内で入力してください。");
  return {...current,title};
 }
 if(field==="body"){
  const body=value.trim();
  if(!body||body.length>3000)throw Error("募集内容は1〜3000文字で入力してください。");
  return {...current,body};
 }
 if(current.mode!=="manual")throw Error("PROFILE_LINKED_FIELD_READ_ONLY");
 if(field==="nickname"){
  const basic=parseProfileBasic(value.trim()+"\n"+current.heightCm+" "+current.weightKg+" "+current.age);
  return {...current,nickname:basic.nickname};
 }
 const basic=parseProfileBasic(current.nickname+"\n"+value.trim());
 return {...current,heightCm:basic.heightCm,weightKg:basic.weightKg,age:basic.age};
}
/** Shared identity portion: preserves the adopted recruitment order and
 * escapes user input for Telegram HTML. ROOM consumes the same fields.
 */
export function recruitmentIdentityLines(draft:RecruitmentInput,
 profile?:ProfileBasicDraft|null):string[]{
 const e=escapeProfileHtml;
 if(draft.mode==="manual"){
  return ["ニックネーム："+e(draft.nickname??""),
   [draft.heightCm+"cm",draft.weightKg+"kg",draft.age+"歳",
    draft.position?e(draft.position):""].filter(Boolean).join(" | ")];
 }
 if(!profile)throw Error("PROFILE_REQUIRED_FOR_LINKED_RECRUITMENT");
 return ["🪪 "+e(profile.nickname),
  profile.heightCm+"cm | "+profile.weightKg+"kg | "+profile.age+"歳"+
   ("position" in profile&&typeof profile.position==="string"?
    " | "+e(profile.position):"")];
}
export function renderRecruitmentPreview(
 draft:RecruitmentInput,profile?:ProfileBasicDraft|null,
):string{
 const e=escapeProfileHtml;
 const rows=["📢 <b>"+e(draft.title)+"</b>"];
 if(draft.mode==="manual")rows.push(...recruitmentIdentityLines(draft,profile));
 rows.push("");
 rows.push("<b>募集内容</b>");
 rows.push(e(draft.body));
 if(draft.mode==="linked")rows.push(...recruitmentIdentityLines(draft,profile));
 if(draft.purposeCodes.length)rows.push("🎯 目的："+draft.purposeCodes.map(t=>"#"+e(t)).join(" "));
 if(draft.placeCodes.length)rows.push("📍 場所："+draft.placeCodes.map(t=>"#"+e(t)).join(" "));
 return rows.join("\n");
}
export function validateRecruitmentReady(d:RecruitmentInput,profile?:ProfileBasicDraft|null){
 if(!d.title?.trim()||!d.body?.trim())throw Error("RECRUITMENT_INPUT_INCOMPLETE");
 if(d.mode==="manual"){
  if(!d.nickname||!d.heightCm||!d.weightKg||!d.age||!isProfilePosition(d.position??""))
   throw Error("ポジションを選択してください。");
 }else if(!profile||!isProfilePosition(profile.position??""))
  throw Error("必須項目が揃った保存済みプロフィールが必要です。");
 validateAnnouncementTags({purposeCodes:d.purposeCodes,placeCodes:d.placeCodes});
 if(d.purposeCodes.length===0)throw Error("目的を1つ以上選択してください。");
}
