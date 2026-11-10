/** Shared TGtumbler private-DM wizard transport.
 * Never delete public posts, publication receipts or messages in group chats.
 * Persist the returned screen ID in the owning draft repository.
 */
import {Markup, type Telegram} from "telegraf";

export type WizardKeyboard = ReturnType<typeof Markup.inlineKeyboard>;
export async function showWizardScreen(
 telegram:Telegram, chatId:number, previousMessageId:number|undefined,
 text:string, keyboard?:WizardKeyboard, parseMode?:"HTML",
):Promise<{messageId:number;replaced:boolean}>{
 if(!Number.isSafeInteger(chatId)||chatId<=0)throw new Error("WIZARD_PRIVATE_CHAT_REQUIRED");
 const display=parseMode?{...keyboard,parse_mode:parseMode}:keyboard;
 const oldId=Number.isSafeInteger(previousMessageId)&&Number(previousMessageId)>0?previousMessageId:undefined;
 if(oldId){
  try{
   await telegram.editMessageText(chatId,oldId,undefined,text,display);
   return {messageId:oldId,replaced:true};
  }catch(e){
   if(e instanceof Error && /message is not modified/i.test(e.message))
    return {messageId:oldId,replaced:true};
   // Use an explicit fallback only when Telegram rejects editing the old screen.
   // Never log profile/post text or a Telegram token.
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
