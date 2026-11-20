/** Profile draft media metadata, sourced only from Telegram private DM. */
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
 return [...existing,item];
}
export function validateProfileMedia(items:readonly ProfileMediaItem[]|undefined):void{
 if(!items)return;
 if(!Array.isArray(items))throw Error("PROFILE_MEDIA_INVALID");
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
