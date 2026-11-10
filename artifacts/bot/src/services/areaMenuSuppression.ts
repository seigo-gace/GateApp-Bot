/** Area's BBS-only suppression of legacy Telegram input chrome.
 * Does not alter default/private scopes or other groups. */
import type {Telegram} from "telegraf";

export const AREA_BBS_CHAT_ID = -1003847210571;
const SHOWTIME_LEGACY_BOT_ID = 8086265383;

const AREA_COMMAND_SCOPES = [
  { type: "chat" as const, chat_id: AREA_BBS_CHAT_ID },
  { type: "chat_administrators" as const, chat_id: AREA_BBS_CHAT_ID },
];

export type AreaCommandSuppressionResult = {
  chatId: number;
  scopesCleared: string[];
  legacyBotId: number;
  legacyBotStatus: string;
  legacyBotRemoved: boolean;
};

/** Shared command suppression: group-scoped, never changes default/other groups.
 * Only the verified group and this Bot identity are modified. No Bot ban/kick.
 */
export const VIDEO_CHAT_CHAT_ID = -1002373696859;
export const GAY_BOARD_CHAT_ID = -1003770334893;
const ALLOWED_GROUP_COMMAND_TARGETS=new Set([
  AREA_BBS_CHAT_ID,VIDEO_CHAT_CHAT_ID,GAY_BOARD_CHAT_ID,
]);
export async function suppressBotDmCommandMenu(telegram:Telegram):Promise<string[]>{
 const scopes=[
  {type:"default" as const},
  {type:"all_private_chats" as const},
 ];
 const cleared:string[]=[];
 for(const scope of scopes){
  await telegram.setMyCommands([],{scope,language_code:""});
  const after=await telegram.getMyCommands({scope,language_code:""});
  if(after.length!==0)throw new Error("DM_COMMAND_READBACK_NOT_EMPTY:"+scope.type);
  cleared.push(scope.type);
 }
 return cleared;
}
export async function suppressGroupCommandMenu(telegram:Telegram,chatId:number):Promise<string[]>{
 if(!ALLOWED_GROUP_COMMAND_TARGETS.has(chatId))
  throw new Error("GROUP_COMMAND_TARGET_NOT_ALLOWED");
 const me=await telegram.getMe();
 const status=await telegram.getChatMember(chatId,me.id);
 if(status.status!=="administrator"&&status.status!=="creator")
  throw new Error("GROUP_COMMAND_BOT_NOT_ADMIN");
 const scopes=[
  {type:"chat" as const,chat_id:chatId},
  {type:"chat_administrators" as const,chat_id:chatId},
 ];
 const cleared:string[]=[];
 for(const scope of scopes){
  // Explicitly empty group scope. Do not delete to reveal inherited commands.
  await telegram.setMyCommands([],{scope,language_code:""});
  const after=await telegram.getMyCommands({scope,language_code:""});
  if(after.length!==0)throw new Error("GROUP_COMMAND_READBACK_NOT_EMPTY:"+scope.type);
  cleared.push(scope.type);
 }
 return cleared;
}
export async function suppressAreaCommandMenu(
  telegram: Telegram,
): Promise<AreaCommandSuppressionResult> {
  const scopesCleared=await suppressGroupCommandMenu(telegram,AREA_BBS_CHAT_ID);
  let legacyBotStatus = "unknown";
  let legacyBotRemoved = false;
  try {
    const member = await telegram.getChatMember(AREA_BBS_CHAT_ID, SHOWTIME_LEGACY_BOT_ID);
    legacyBotStatus = member.status;
    // Group membership inspection only; never ban/kick/rejoin existing bots
    // as a side-effect of suppressing this bot's own command menu.

  } catch {
    legacyBotStatus = "lookup_failed";
  }
  return {
    chatId: AREA_BBS_CHAT_ID,
    scopesCleared,
    legacyBotId: SHOWTIME_LEGACY_BOT_ID,
    legacyBotStatus,
    legacyBotRemoved,
  };
}
