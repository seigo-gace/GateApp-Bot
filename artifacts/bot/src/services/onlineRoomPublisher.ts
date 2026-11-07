/** ONLINE photo-card publisher: explicit verified assets/links from the
 * existing runtime only. Never infer Telegram thread IDs from t.me/c URLs.
 * A partial Telegram send is reconciled, not blindly retried.
 */
import type {OnlineCard,OnlineGateLink,OnlineCardKey} from "./onlineRoomBoard.js";
import {renderOnlineRoomCards,ONLINE_CARD_ORDER} from "./onlineRoomBoard.js";

export type OnlineMediaAsset={bytes:Buffer;mimeType:"image/jpeg"|"image/png";width:number;height:number;verifiedDriveFileId:string};
export type OnlinePhotoTarget={chatId:number;threadId:number};
export type OnlinePhotoSender=(args:{target:OnlinePhotoTarget;card:OnlineCard;media:OnlineMediaAsset})=>Promise<number>;
export type OnlinePhotoReceipt={key:OnlineCardKey;messageId:number};
export type OnlinePhotoStore={
 claim:(target:OnlinePhotoTarget)=>Promise<{setId:number;existing:readonly OnlinePhotoReceipt[]}>;
 record:(setId:number,receipt:OnlinePhotoReceipt)=>Promise<void>;
 finish:(setId:number)=>Promise<void>;
 reconcile:(setId:number,reason:string)=>Promise<void>;
};
export type OnlinePhotoDeps={
 getAsset:(fileId:string)=>Promise<OnlineMediaAsset>;
 send:OnlinePhotoSender;
 store:OnlinePhotoStore;
};
export async function publishOnlineRoomCards(
 target:OnlinePhotoTarget,
 links:readonly OnlineGateLink[],
 deps:OnlinePhotoDeps,
):Promise<readonly OnlinePhotoReceipt[]>{
 if(target.chatId!==-1003847210571||!Number.isSafeInteger(target.threadId)||target.threadId<=0)
  throw new Error("ONLINE_TOPIC_UNVERIFIED");
 // Validate complete card set BEFORE claiming publication.
 const cards=renderOnlineRoomCards(links);
 const media:OnlineMediaAsset[]=[];
 for(const card of cards){
  const asset=await deps.getAsset(card.image.driveFileId);
  if(asset.verifiedDriveFileId!==card.image.driveFileId||
     !Buffer.isBuffer(asset.bytes)||asset.bytes.length===0||
     asset.width!==1080||asset.height!==1080||
     (card.image.filename.endsWith(".png")?asset.mimeType!=="image/png":asset.mimeType!=="image/jpeg"))
   throw new Error("ONLINE_MEDIA_NOT_VERIFIED:"+card.key);
  media.push(asset);
 }
 const claim=await deps.store.claim(target);
 const receipts=[...claim.existing];
 if(receipts.length){
  // No partial automatic retry, even if some image posts succeeded.
  await deps.store.reconcile(claim.setId,"ONLINE_EXISTING_RECEIPTS_RECONCILE");
  throw new Error("ONLINE_EXISTING_RECEIPTS_RECONCILE");
 }
 try{
  for(let i=0;i<cards.length;i++){
   const card=cards[i]!;
   const messageId=await deps.send({target,card,media:media[i]!});
   if(!Number.isSafeInteger(messageId)||messageId<=0)
    throw new Error("ONLINE_SEND_RECEIPT_INVALID:"+card.key);
   const receipt={key:card.key,messageId};
   receipts.push(receipt);
   await deps.store.record(claim.setId,receipt);
  }
  if(receipts.length!==ONLINE_CARD_ORDER.length)
   throw new Error("ONLINE_PARTIAL_PUBLICATION");
  await deps.store.finish(claim.setId);
  return receipts;
 }catch(e){
  await deps.store.reconcile(claim.setId,e instanceof Error?e.message:"UNKNOWN");
  throw e;
 }
}
