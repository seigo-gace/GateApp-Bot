/** Profile draft media metadata, sourced only from Telegram private DM. */
/** New profile albums contain up to five Telegram photo/video references combined. */
export const PROFILE_ALBUM_LIMIT=5;
export type ProfileMediaItem={
 type:"photo"|"video";
 itemId?:number;
 fileId:string;
 sourceMessageId:number;
 mediaGroupId?:string;
};
export function appendProfileMedia(items:readonly ProfileMediaItem[]|undefined,item:ProfileMediaItem):ProfileMediaItem[]{
 if(!Number.isSafeInteger(item.sourceMessageId)||item.sourceMessageId<=0 ||
    !item.fileId||item.fileId.length>512||
    !["photo","video"].includes(item.type)||
    (item.mediaGroupId!==undefined && item.mediaGroupId.length>128))
  throw Error("PROFILE_MEDIA_INVALID");
 const existing=items??[];
 if(item.itemId!==undefined&&(!Number.isSafeInteger(item.itemId)||item.itemId<1))throw Error("PROFILE_MEDIA_INVALID");
 // The original Telegram message is the durable idempotency key.
 if(existing.some(x=>x.sourceMessageId===item.sourceMessageId))return [...existing];
 if(existing.length>=PROFILE_ALBUM_LIMIT)throw Error("PROFILE_ALBUM_FULL");
 return [...existing,item];
}
export function validateProfileMedia(items:readonly ProfileMediaItem[]|undefined):void{
 if(!items)return;
 if(!Array.isArray(items))throw Error("PROFILE_MEDIA_INVALID");
 if(items.length>PROFILE_ALBUM_LIMIT)throw Error("PROFILE_ALBUM_LIMIT_EXCEEDED");
 const seen=new Set<number>();
 const seenIds=new Set<number>();
 for(const item of items){
  appendProfileMedia([],item);
  if(seen.has(item.sourceMessageId))throw Error("PROFILE_MEDIA_DUPLICATE");
  seen.add(item.sourceMessageId);
  if(item.itemId!==undefined){
   if(seenIds.has(item.itemId))throw Error("PROFILE_MEDIA_DUPLICATE");
   seenIds.add(item.itemId);
  }
 }
}
export function mediaStatus(items:readonly ProfileMediaItem[]|undefined,pr:string|null|undefined){
 const ms=items??[];
 return [
  "🖼️ 画像："+ms.filter(m=>m.type==="photo").length+"件",
  "🎬 動画："+ms.filter(m=>m.type==="video").length+"件",
  "📝 自己PR："+(pr?.trim()?"登録済み":"未登録"),
 ];
}

/** Assign immutable, owner-local item numbers. Never renumber after deletion. */
export function numberProfileMedia(items:readonly ProfileMediaItem[]|undefined):ProfileMediaItem[]{
 const list=items??[];
 const allocated=new Set<number>();
 let last=0;
 for(const entry of list){
  if(entry.itemId!==undefined){
   if(!Number.isSafeInteger(entry.itemId)||entry.itemId<1||allocated.has(entry.itemId))
    throw Error("PROFILE_MEDIA_DUPLICATE");
   allocated.add(entry.itemId);
   last=Math.max(last,entry.itemId);
  }
 }
 return list.map(entry=>{
  if(entry.itemId!==undefined)return {...entry};
  do{last++;}while(allocated.has(last));
  allocated.add(last);
  return {...entry,itemId:last};
 });
}
export function replaceProfileMedia(items:readonly ProfileMediaItem[],itemId:number,
 entry:ProfileMediaItem):ProfileMediaItem[]{
 const present=numberProfileMedia(items);
 if(!present.some(x=>x.itemId===itemId))throw Error("PROFILE_MEDIA_ITEM_NOT_FOUND");
 const result=present.map(x=>x.itemId===itemId?{...entry,itemId}:x);
 validateProfileMedia(result);
 return result;
}
export function deleteProfileMedia(items:readonly ProfileMediaItem[],itemId:number):ProfileMediaItem[]{
 const present=numberProfileMedia(items);
 if(!present.some(x=>x.itemId===itemId))throw Error("PROFILE_MEDIA_ITEM_NOT_FOUND");
 return present.filter(x=>x.itemId!==itemId);
}

/** Shared compact album editor. The caller owns the draft and publish action. */
export type CompactAlbumState={media?:ProfileMediaItem[];mediaNextId?:number;replaceMediaId?:number};
export function compactAlbumText(label:string,d:CompactAlbumState):string{
 const media=numberProfileMedia(d.media);
 return "🖼️🎬 "+label+"のアルバム\n画像・動画は合計"+PROFILE_ALBUM_LIMIT+"件まで。"+
  "\nTelegramの添付から写真・動画を送ってください。"+
  "\n既存の画像/動画を変える場合「差替 番号」、消す場合「削除 番号」と入力。"+
  "\n登録済み "+media.length+"/"+PROFILE_ALBUM_LIMIT+"件"+
  (media.length?"\n"+media.map(v=>"No."+v.itemId+" "+(v.type==="photo"?"🖼️画像":"🎬動画")).join("\n"):"")+
  (d.replaceMediaId?"\n差替対象：No."+d.replaceMediaId:"")+
  "\n元画像をグループへ自動公開しません。";
}
export function compactAlbumRows(callbacks:{album:string;back:string;save:string;cancel:string},saveLabel="✅ 保存・投稿"){
 return [
  [{text:"🖼️アルバムを見る",callback:callbacks.album,style:"primary" as const}],
  [{text:"↩ 戻る",callback:callbacks.back,style:undefined},
   {text:saveLabel,callback:callbacks.save,style:"success" as const},
   {text:"キャンセル",callback:callbacks.cancel,style:"danger" as const}],
 ];
}
export function updateCompactAlbumText<T extends CompactAlbumState>(d:T,text:string):T{
 const value=text.trim(),match=/^(削除|差替)\s*(\d+)$/.exec(value),old=numberProfileMedia(d.media);
 if(match){
  const id=Number(match[2]);
  if(!old.some(v=>v.itemId===id))throw Error("指定番号はアルバムにありません。");
  if(match[1]==="削除")return {...d,media:deleteProfileMedia(old,id),replaceMediaId:undefined};
  return {...d,replaceMediaId:id};
 }
 if(value==="差替取消")return {...d,replaceMediaId:undefined};
 throw Error("画像・動画は添付で送信。差替・削除は番号を指定してください。");
}
export function updateCompactAlbumMedia<T extends CompactAlbumState>(d:T,entry:ProfileMediaItem):T{
 const old=numberProfileMedia(d.media);
 if(old.some(v=>v.sourceMessageId===entry.sourceMessageId))return d;
 const replace=d.replaceMediaId;
 const id=Math.max(d.mediaNextId??1,...old.map(v=>(v.itemId??0)+1),1);
 const media=replace!==undefined?replaceProfileMedia(old,replace,entry):
  numberProfileMedia(appendProfileMedia(old,{...entry,itemId:id}));
 return {...d,media,mediaNextId:replace!==undefined?id:id+1,replaceMediaId:undefined};
}
