/** One explicit entry point for Composer's approved later production release.
 * This module does not register a command, run on startup or send by itself.
 * The caller must verify the existing ONLINE Topic and bot admin ownership.
 */
import type {Telegram} from "telegraf";
import {pool} from "../db/index.js";
import {getOnlineGateLinks} from "./onlineGateRoutes.js";
import {onlineDriveAssetLoader} from "./onlineDriveAssetLoader.js";
import {publishOnlineRoomCards,type OnlinePhotoReceipt} from "./onlineRoomPublisher.js";
import {onlineRoomPhotoSender,onlineRoomPhotoStore} from "./onlineRoomRuntimeAdapter.js";

export type OnlineReleasePreflight={
 chatId:number;threadId:number;verifiedBy:number;
 imageRoot:string;
};
/** Requires current existing topic identity from DB; never use t.me/c URL
 * suffix as the Telegram message_thread_id. No write occurs until publisher
 * obtains an atomic verified-set claim and passes all asset/link prechecks.
 */
export async function releaseOnlineRoomBoard(
 telegram:Telegram,
 input:OnlineReleasePreflight,
):Promise<readonly OnlinePhotoReceipt[]>{
 if(input.chatId!==-1003847210571||!Number.isSafeInteger(input.threadId)||
    input.threadId<=0||!Number.isSafeInteger(input.verifiedBy)||input.verifiedBy<=0)
  throw new Error("ONLINE_RELEASE_TARGET_UNVERIFIED");
 const existing=await pool.query(
  `SELECT set_id,state,verified_by FROM online_room_board_sets
   WHERE chat_id=$1 AND message_thread_id=$2`,
  [input.chatId,input.threadId]);
 if(existing.rows.length!==1||existing.rows[0].state!=="verified"||
    Number(existing.rows[0].verified_by)!==input.verifiedBy)
  throw new Error("ONLINE_RELEASE_NOT_ADMIN_VERIFIED");
 const self=await telegram.getMe();
 const botMembership=await telegram.getChatMember(input.chatId,self.id);
 if(botMembership.status!=="administrator"&&botMembership.status!=="creator")
  throw new Error("ONLINE_RELEASE_BOT_NOT_ADMIN");
 const links=await getOnlineGateLinks(); // 3 enabled and topic-verified GATE URLs
 if(links.some(x=>!x.verified))throw new Error("ONLINE_RELEASE_GATE_NOT_ENABLED");
 const getAsset=onlineDriveAssetLoader(input.imageRoot);
 return publishOnlineRoomCards(
  {chatId:input.chatId,threadId:input.threadId},links,
  {getAsset,send:onlineRoomPhotoSender(telegram),store:onlineRoomPhotoStore});
}
