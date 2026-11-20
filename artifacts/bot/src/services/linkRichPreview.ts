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
/** One canonical public appearance for the editor preview and inline post code. */
export function linkRichPublication(draft:LinkDraft){
 validateLinkDraft(draft);
 if(draft.media?.type==="sticker")throw Error("LINK_STICKER_USE_NATIVE_MESSAGE");
 const blocks:RichBlock[]=[];
 if(draft.media&&draft.captionAbove&&draft.text.trim())blocks.push(paragraph(draft.text));
 for(const media of [...(draft.media?[draft.media]:[]),...(draft.mediaExtras??[])]){
  const caption=media.caption?{caption:{text:media.caption}}:{};
  blocks.push(media.type==="photo"
   ?{type:"photo",photo:{type:"photo",media:media.fileId},...caption}
   :media.type==="video"
   ?{type:"video",video:{type:"video",media:media.fileId},...caption}
   :{type:"document",document:{type:"document",media:media.fileId},...caption});
 }
 if(draft.text.trim()&&(!draft.media||!draft.captionAbove))blocks.push(paragraph(draft.text));
 // URL buttons are placed in Telegram's reply_markup, not the Rich body.
 // This keeps their real click targets and rows identical in DM preview and publication.
 return {blocks};
}

/** The real clickable URL rows, shared by preview and published inline result.
 * Rich text editing controls remain in the body; these links belong below it.
 * Telegram's own actual UI constraints are evaluated independently of layout intent.
 */
export function linkUrlKeyboardRows(draft:LinkDraft):Array<Array<Record<string,unknown>>>{
 validateLinkDraft(draft);
 return buttonGrid(draft).map(row=>row.map(button=>richLink(button.label,button.url,button.style)));
}

/** Private preview: exactly the public body, followed by two tappable edit links. */
export function linkRichPreview(draft:LinkDraft,revision:number,shareCode?:string){
 const blocks:RichBlock[]=[];
 if(shareCode){
  const code="@GayBBS_bot "+shareCode;
  blocks.push(paragraph("投稿コード："+code));
  // RichMessageButton has no copy_text field in Bot API.\n  // Keep the code as selectable text; post-registration copy uses a native keyboard button.
 }
 blocks.push(...linkRichPublication(draft).blocks);
 if(!shareCode){
  blocks.push({type:"divider"});
  blocks.push(paragraph("変更したい内容をタップしてください。"));
  blocks.push(paragraph(richAction("［ボタンの追加］","post:link:panel:"+revision)));
  blocks.push(paragraph(richAction("［内容の編集］","post:link:content:"+revision)));
 }
 return {blocks};
}

/** Shown only after a confirmed registration. URL buttons and edit actions
 * are deliberately not mixed with the copyable receipt and navigation.
 */
export function linkRichRegisteredReceipt(code:string){
 if(!/^[A-Za-z0-9_-]{24}$/.test(code))throw Error("LINK_RECEIPT_CODE_INVALID");
 return {blocks:[
  paragraph("✅ 登録が完了しました"),
  paragraph("登録コード：@GayBBS_bot "+code),
  {type:"divider"},
  paragraph("投稿する方法"),
  paragraph("登録コードをタップしてコピーし、投稿したいTelegramのチャットの入力欄に貼り付けてください。表示された投稿候補を選択すると、登録した内容とリンクボタンを送信できます。"),
 ]};
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
 if(draft.media)blocks.push(paragraph([richAction("［編集］","post:link:field:"+revision+":media"),selectedField==="media"?"✅ ":"", draft.media.type==="photo"?"画像":draft.media.type==="document"?"動画ファイル":"動画"]));
 draft.buttons.forEach((b,i)=>blocks.push(paragraph([
  richAction("［編集］","post:link:field:"+revision+":b"+i),
  selectedField==="b"+i?"✅ ":"", "ボタンタイトル"+(i+1)+"："+b.label,
 ])));
 return {blocks};
}
