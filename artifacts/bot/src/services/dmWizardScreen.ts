/** Shared TGtumbler private-DM wizard transport.
 * Never delete public posts, publication receipts or messages in group chats.
 * Persist the returned screen ID in the owning draft repository.
 */
import {Markup, type Telegram} from "telegraf";

export type WizardKeyboard = ReturnType<typeof Markup.inlineKeyboard>;
/** One policy for profile, ROOM, recruitment, help and search.
 * Ambiguous Telegram edit outcomes must not trigger a duplicate send. */
export function wizardEditOutcome(error:unknown):"unchanged"|"missing"|"unknown"{
 const reason=error instanceof Error?error.message:"";
 if(/message is not modified/i.test(reason))return "unchanged";
 if(/message (?:to edit|to be edited) not found|message can.t be edited|message cannot be edited|MESSAGE_ID_INVALID/i.test(reason))
  return "missing";
 return "unknown";
}
export async function showWizardScreen(
 telegram:Telegram, chatId:number, previousMessageId:number|undefined,
 text:string, keyboard?:WizardKeyboard,
):Promise<{messageId:number;replaced:boolean}>{
 if(!Number.isSafeInteger(chatId)||chatId<=0)throw new Error("WIZARD_PRIVATE_CHAT_REQUIRED");
 const oldId=Number.isSafeInteger(previousMessageId)&&Number(previousMessageId)>0?previousMessageId:undefined;
 if(oldId){
  try{
   await telegram.editMessageText(chatId,oldId,undefined,text,keyboard);
   return {messageId:oldId,replaced:true};
  }catch(e){
   const outcome=wizardEditOutcome(e);
   if(outcome==="unchanged")return {messageId:oldId,replaced:true};
   // An edit timeout/5xx can occur AFTER Telegram has already edited the
   // message. Align with VideoBot's shared screen transport: never create
   // an additional screen unless Telegram explicitly says it cannot edit.
   if(outcome!=="missing")throw new Error("WIZARD_EDIT_RESULT_UNKNOWN");
   // The old private Bot screen was definitively rejected. Fallback is safe.
  }
 }
 const msg=await telegram.sendMessage(chatId,text,keyboard);
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
