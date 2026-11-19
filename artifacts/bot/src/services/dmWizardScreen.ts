/** Shared TGtumbler private-DM wizard transport.
 * Never delete public posts, publication receipts or messages in group chats.
 * Persist the returned screen ID in the owning draft repository.
 */
import {Markup, type Telegram} from "telegraf";
import {assertTelegramInlineKeyboard} from "./telegramClientCompatibility.js";

export type WizardKeyboard = ReturnType<typeof Markup.inlineKeyboard>;
/** Only a definite Telegram rejection permits replacing an old screen.
 * A timeout/connection loss may mean the edit already reached Telegram; sending
 * a second screen would violate the one-screen wizard contract.
 */
export function wizardEditFailureKind(error:unknown):"unchanged"|"rejected"|"uncertain"{
 const e=error as {message?:unknown;description?:unknown;response?:{description?:unknown;error_code?:unknown}}|null;
 const description=String(e?.description??e?.response?.description??e?.message??"").toLowerCase();
 if(description.includes("message is not modified"))return "unchanged";
 const code=Number(e?.response?.error_code);
 const definitelyRejected=code===400 || /^(400:|telegram: 400|bad request:)/.test(description);
 if(definitelyRejected&&[
  "message to edit not found","message can't be edited",
  "message cannot be edited","message to edit is not found",
  "there is no text in the message to edit",
 ].some(x=>description.includes(x)))return "rejected";
 return "uncertain";
}

export async function showWizardScreen(
 telegram:Telegram, chatId:number, previousMessageId:number|undefined,
 text:string, keyboard?:WizardKeyboard, parseMode?:"HTML",
):Promise<{messageId:number;replaced:boolean}>{
 if(!Number.isSafeInteger(chatId)||chatId<=0)throw new Error("WIZARD_PRIVATE_CHAT_REQUIRED");
 if(keyboard)assertTelegramInlineKeyboard(keyboard);
 const display=parseMode?{...keyboard,parse_mode:parseMode}:keyboard;
 const oldId=Number.isSafeInteger(previousMessageId)&&Number(previousMessageId)>0?previousMessageId:undefined;
 if(oldId){
  try{
   await telegram.editMessageText(chatId,oldId,undefined,text,display);
   return {messageId:oldId,replaced:true};
  }catch(e){
   const kind=wizardEditFailureKind(e);
   if(kind==="unchanged")return {messageId:oldId,replaced:true};
   // Do not duplicate a screen after an ambiguous timeout or transport fault.
   // It may already have been updated. Caller retains the old screen ID.
   if(kind!=="rejected")throw e;
  }
 }
 const msg=await telegram.sendMessage(chatId,text,display);
 if(oldId&&oldId!==msg.message_id){
  try{await telegram.deleteMessage(chatId,oldId);}
  catch{console.warn("[WIZARD_PREVIOUS_SCREEN_DELETE_FAILED]");}
 }
 return {messageId:msg.message_id,replaced:false};
}

export async function removeUserWizardInput(
 telegram:Telegram, chatId:number, inputMessageId:number
):Promise<boolean>{
 if(!Number.isSafeInteger(chatId)||chatId<=0||
    !Number.isSafeInteger(inputMessageId)||inputMessageId<=0)
  throw new Error("WIZARD_PRIVATE_INPUT_REQUIRED");
 try{
  await telegram.deleteMessage(chatId,inputMessageId);
  return true;
 }catch{
  console.warn("[WIZARD_INPUT_DELETE_FAILED]");
  return false;
 }
}
