/** Profile draft media metadata, sourced only from Telegram private DM. */
export type ProfileMediaItem={
 type:"photo"|"video";
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
 // The original Telegram message is the durable idempotency key.
 if(existing.some(x=>x.sourceMessageId===item.sourceMessageId))return [...existing];
 return [...existing,item];
}
export function validateProfileMedia(items:readonly ProfileMediaItem[]|undefined):void{
 if(!items)return;
 if(!Array.isArray(items)||items.length>100)throw Error("PROFILE_MEDIA_LIMIT");
 const seen=new Set<number>();
 for(const item of items){
  appendProfileMedia([],item);
  if(seen.has(item.sourceMessageId))throw Error("PROFILE_MEDIA_DUPLICATE");
  seen.add(item.sourceMessageId);
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
