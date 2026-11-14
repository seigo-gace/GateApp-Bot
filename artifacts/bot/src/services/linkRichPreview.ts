/** Telegram Bot API Rich Message preview.
 * The actual URL buttons are tappable; the in-body [編集] buttons are
 * callback elements, separate from the published link buttons.
 */
import {buttonGrid,validateLinkDraft,type LinkDraft} from "./linkButtonDomain.js";
type Block=Record<string,unknown>;
const para=(text:unknown):Block=>({type:"paragraph",text});
const edit=(label:string,field:string,revision:number):Block=>
 para([label,{type:"button",button:{
  text:"［編集］",style:"link",callback_data:"post:link:"+field+":"+revision,
 }}]);
export function linkRichPreview(draft:LinkDraft,revision:number,code?:string){
 validateLinkDraft(draft);
 const blocks:Block[]=[];
 if(code){
  const complete="@GayBBS_bot "+code;
  blocks.push(para("📋 投稿用コード\n"+complete));
  blocks.push(para({type:"button",button:{
   text:"📋 投稿コードをコピー",copy_text:{text:complete},
  }}));
  blocks.push(para("① コードをコピー → ② 投稿先の入力欄に貼る → ③ 表示された候補をタップして投稿"));
  blocks.push({type:"divider"});
 }
 if(draft.media&&draft.captionAbove&&draft.text.trim())blocks.push(para(draft.text));
 if(draft.media){
  const m=draft.media;
  blocks.push(m.type==="photo"?{
   type:"photo",photo:{type:"photo",media:m.fileId},
  }:{
   type:"video",video:{type:"video",media:m.fileId},
  });
 }
 if(draft.text.trim()&&(!draft.media||!draft.captionAbove))blocks.push(para(draft.text));
 blocks.push({type:"divider"});
 blocks.push(para("編集はこちらから"));
 blocks.push(edit("テキスト","edittext",revision));
 blocks.push(edit("画像/動画","editmedia",revision));
 blocks.push(edit("ボタン","panel",revision));
 for(const row of buttonGrid(draft)){
  if(row.length>8)throw Error("LINK_RICH_ROW_TOO_WIDE");
  blocks.push({type:"buttons",buttons:row.map(b=>({
    text:b.label,url:b.url,...(b.style?{style:b.style}:{}),
  }))});
 }
 return {blocks};
}

/** Editor is NOT a copy of the public preview. It displays only edit links,
 * title/URL and a compact row-number map; public buttons stay tappable in preview.
 */
export function linkRichEditor(draft:LinkDraft,revision:number){
 validateLinkDraft(draft);
 const blocks:Block[]=[para("🔗 ボタン編集")];
 const marks=["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩"];
 const number=(n:number)=>marks[n]??String(n+1);
 draft.buttons.forEach((b,i)=>{
  const editItem={type:"button",button:{text:"［編集］",style:"link",
   callback_data:"post:link:edit:"+revision+":"+i}};
  blocks.push(para([editItem,number(i)+" "+b.label+" / "+b.url]));
 });
 const grouped=buttonGrid(draft);
 let offset=0;
 blocks.push(para("【ボタン配置】"));
 grouped.forEach(row=>{
  blocks.push(para(row.map((_,index)=>"［"+number(offset+index)+"］").join("")));
  offset+=row.length;
 });
 blocks.push({type:"divider"});
 blocks.push({type:"buttons",buttons:[{
  text:"＋↓にボタンをつける",callback_data:"post:link:add:"+revision,
 }]});
 grouped.forEach((_,i)=>{
  blocks.push({type:"buttons",buttons:[{
   text:i===0?"➔にボタンを追加":"➔にボタンを追加（"+(i+1)+"列目）",
   callback_data:"post:link:beside:"+revision+":"+i,
  }]});
 });
 blocks.push({type:"buttons",buttons:[{
  text:"👁 プレビュー",callback_data:"post:link:back:"+revision,
 },{text:"キャンセル",callback_data:"post:link:cancel:"+revision}]});
 return {blocks};
}
