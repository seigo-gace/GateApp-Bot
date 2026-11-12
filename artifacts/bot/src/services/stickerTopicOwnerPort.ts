import {pool} from "../db/index.js";
import {getVerifiedStickerTopic} from "./postingDelivery.js";
import {createStickerEntryPinService,createStickerEntryPinStore} from "./stickerTopicEntryPin.js";

/** This is the existing GateApp-Bot owner-side port for CreateVdobot.
 * It does not issue a Topic ID, create another Bot/DB, or self-certify seller
 * review. The private Gserver gateOwner adapter can supply a verified
 * CreateVdobot Telegram transport without exposing tokens across modules.
 */
export function createStickerTopicOwnerPort({
 creatorBotApi,
}:{
 creatorBotApi:(method:string,params:Record<string,unknown>)=>Promise<unknown>;
}){
 if(typeof creatorBotApi!=="function")
   throw new Error("STICKER_OWNER_CREATOR_BOT_REQUIRED");
 const ensureStickerEntryPin=createStickerEntryPinService({
   getVerifiedStickerTopic,creatorBotApi,
   store:createStickerEntryPinStore(pool)
 });
 return Object.freeze({getVerifiedStickerTopic,ensureStickerEntryPin});
}
