/** Master-approved 2026-11-20 link editor Rich Message body.
 * Editor actions are inline RichTextButton callbacks IN THE MESSAGE BODY.
 * Only Register and Cancel may appear in the preview reply_markup keyboard.
 * This module never sends Telegram messages and never publishes a draft.
 */
import {buttonGrid,validateLinkDraft,type LinkDraft} from "./linkButtonDomain.js";

type RichBlock=Record<string,unknown>;
const paragraph=(text:unknown):RichBlock=>({type:"paragraph",text});
const richAction=(label:string,callback:string):Record<string,unknown>=>({
 type:"button",button:{text:label,style:"link",callback_data:callback},
});
const richLink=(label:string,url:string,style?:"primary"|"success"|"danger")=>({
 text:label,url,...(style?{style}:{}),
});

/** Actual publication-media/text/URL-button view followed by exactly two
 * tappable text actions in the content. Register/Cancel belong to keyboard.
 * When shareCode is provided, its copy action lives in the body too.
 */
export function linkRichPreview(draft:LinkDraft,revision:number,shareCode?:string){
 validateLinkDraft(draft);
 const blocks:RichBlock[]=[];
 if(shareCode){
  const code="@GayBBS_bot "+shareCode;
  blocks.push(paragraph("投稿コード："+code));
  blocks.push(paragraph({type:"button",button:{text:"［投稿コードをコピー］",copy_text:{text:code}}}));
 }
 if(draft.media&&draft.captionAbove&&draft.text.trim())blocks.push(paragraph(draft.text));
 if(draft.media){
  blocks.push(draft.media.type==="photo"
   ?{type:"photo",photo:{type:"photo",media:draft.media.fileId}}
   :{type:"video",video:{type:"video",media:draft.media.fileId}});
 }
 if(draft.text.trim()&&(!draft.media||!draft.captionAbove))blocks.push(paragraph(draft.text));
 for(const row of buttonGrid(draft)){
  if(row.length>8)throw new Error("LINK_RICH_ROW_TOO_WIDE");
  blocks.push({type:"buttons",buttons:row.map(b=>richLink(b.label,b.url,b.style))});
 }
 blocks.push({type:"divider"});
 blocks.push(paragraph("変更したい内容をタップしてください。"));
 blocks.push(paragraph(richAction("［ボタンの追加］","post:link:panel:"+revision)));
 blocks.push(paragraph(richAction("［内容の編集］","post:link:content:"+revision)));
 return {blocks};
}

/** ④ In-body position selection, per-button delete and arrow controls.
 * Input pair and 4-color selection are rendered in the existing DM wizard.
 */
export function linkRichPlacement(draft:LinkDraft,revision:number){
 validateLinkDraft(draft);
 const blocks:RichBlock[]=[paragraph("🔗 ボタンの追加"),paragraph("ボタンを作りたい場所を選択してください。")];
 let idx=0;
 buttonGrid(draft).forEach((row,rowIndex)=>{
  const parts:unknown[]=[];
  row.forEach(b=>{
   const position=idx++;
   parts.push(b.label+" ");
   parts.push(richAction("［削除］","post:link:delete:"+revision+":"+position));
   parts.push("　");
  });
  parts.push(richAction("［▶］","post:link:beside:"+revision+":"+rowIndex));
  blocks.push(paragraph(parts));
 });
 blocks.push(paragraph(richAction("［▼］","post:link:add:"+revision)));
 blocks.push({type:"divider"});
 blocks.push(paragraph("1行目：ボタンのタイトル\n2行目：ボタンにしたいURL"));
 return {blocks};
}

/** ⑤ Existing paid-video style: pick one field, then change that field only.
 * Missing media entries are omitted; existing fields are never cleared here.
 */
export function linkRichContentEditor(draft:LinkDraft,revision:number,selectedField?:string){
 validateLinkDraft(draft);
 const blocks:RichBlock[]=[paragraph("📝 内容の編集"),paragraph("編集したい項目の［編集］をタップしてください。")];
 if(draft.text.trim())blocks.push(paragraph([richAction("［編集］","post:link:field:"+revision+":text"),selectedField==="text"?"✅ ":"", "テキスト："+draft.text]));
 if(draft.media)blocks.push(paragraph([richAction("［編集］","post:link:field:"+revision+":media"),selectedField==="media"?"✅ ":"", draft.media.type==="photo"?"画像":"動画"]));
 draft.buttons.forEach((b,i)=>blocks.push(paragraph([
  richAction("［編集］","post:link:field:"+revision+":b"+i),
  selectedField==="b"+i?"✅ ":"", "ボタンタイトル"+(i+1)+"："+b.label,
 ])));
 return {blocks};
}
