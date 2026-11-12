import {pool} from "../db/index.js";
import {getVerifiedStickerTopic} from "./postingDelivery.js";
import {createStickerEntryPinService,createStickerEntryPinStore} from "./stickerTopicEntryPin.js";

/** This is the existing GateApp-Bot owner-side port for CreateVdobot.
 * It does not issue a Topic ID, create another Bot/DB, or self-certify seller
 * review. The private Gserver gateOwner adapter can supply a verified
 * CreateVdobot Telegram transport without exposing tokens across modules.
 */
export function createStickerTopicOwnerPort({
 creatorBotApi,creatorBotUsername,postingBotApi,
}:{
 creatorBotApi?:(method:string,params:Record<string,unknown>)=>Promise<unknown>;
 creatorBotUsername?:string;
 postingBotApi:(method:string,params:Record<string,unknown>)=>Promise<unknown>;
}){
 if((typeof creatorBotApi!=="function"&&creatorBotUsername===undefined)||
    (creatorBotApi!==undefined&&creatorBotUsername!==undefined)||
    typeof postingBotApi!=="function")
   throw new Error("STICKER_OWNER_BOT_TARGET_REQUIRED");
 const ensureStickerEntryPin=createStickerEntryPinService({
   getVerifiedStickerTopic,creatorBotApi,creatorBotUsername,postingBotApi,
   store:createStickerEntryPinStore(pool)
 });
 return Object.freeze({getVerifiedStickerTopic,ensureStickerEntryPin});
}
