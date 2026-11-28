/** Area's BBS-only suppression of legacy Telegram input chrome.
 * Does not alter default/private scopes or other groups. */
import type {Telegram} from "telegraf";

export const AREA_BBS_CHAT_ID = -1003847210571;
const SHOWTIME_LEGACY_BOT_ID = 8086265383;

/** Existing bot commands may be registered with language and inherited global scopes.
 * Cover these without deleting any other bot's commands or Telegram client UI.
 */
const COMMAND_LANGUAGES = ["", "ja", "en"] as const;
type CommandScope = {type:"default"|"all_private_chats"|"all_group_chats"|"all_chat_administrators"}|
 {type:"chat"|"chat_administrators";chat_id:number};
async function clearKnownCommandVariants(
 telegram:Telegram,scope:CommandScope,
):Promise<void>{
 for(const language_code of COMMAND_LANGUAGES){
  const existing=await telegram.getMyCommands({scope,language_code});
  if(existing.length===0)continue;
  await telegram.setMyCommands([],{scope,language_code});
  const remaining=await telegram.getMyCommands({scope,language_code});
  if(remaining.length!==0)
   throw Error("BOT_COMMANDS_STILL_REGISTERED:"+scope.type+":"+language_code);
 }
}

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
 const scopes:CommandScope[]=[
  {type:"default"},
  {type:"all_private_chats"},
  {type:"all_group_chats"},
  {type:"all_chat_administrators"},
 ];
 const cleared:string[]=[];
 for(const scope of scopes){
  await clearKnownCommandVariants(telegram,scope);
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
  // Clear per-chat commands after global scopes to avoid inherited command lists.
  await clearKnownCommandVariants(telegram,scope);
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
