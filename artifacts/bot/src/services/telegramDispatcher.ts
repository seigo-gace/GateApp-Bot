/** Adapter of existing -AdminSystem/multipost/dispatcher.ts.
 * Owns Telegram delivery mechanics only; business state stays with Source.
 * Bot API ambiguity is NOT retried here.
 */
import type {Telegram} from "telegraf";
import {Markup} from "telegraf";
export type TransportTarget={chatId:number;threadId:number};
export type TransportMessage={text:string;parseMode?:"HTML"|"MarkdownV2";buttons?:readonly (readonly {text:string;url:string}[])[]};
function assertTarget(t:TransportTarget):void{
 if(!Number.isSafeInteger(t.chatId)||t.chatId>=0||
    !Number.isSafeInteger(t.threadId)||t.threadId<=0)
  throw new Error("MPB_TARGET_UNVERIFIED");
}
function markup(buttons:TransportMessage["buttons"]){
 return buttons?.length?Markup.inlineKeyboard(buttons.map(row=>
  row.map(x=>Markup.button.url(x.text,x.url)))):undefined;
}
export function createTelegramDispatcher(telegram:Telegram){
 return {
  async publish(t:TransportTarget,message:TransportMessage):Promise<number>{
   assertTarget(t);
   const sent=await telegram.sendMessage(t.chatId,message.text,{
    message_thread_id:t.threadId,
    ...(message.parseMode?{parse_mode:message.parseMode}:{}),
    ...(markup(message.buttons)||{}),
   });
   return sent.message_id;
  },
  async revise(t:TransportTarget,messageId:number,message:TransportMessage):Promise<void>{
   assertTarget(t);
   if(!Number.isSafeInteger(messageId)||messageId<=0)throw new Error("MPB_MESSAGE_ID_INVALID");
   await telegram.editMessageText(t.chatId,messageId,undefined,message.text,{
    ...(message.parseMode?{parse_mode:message.parseMode}:{}),
    ...(markup(message.buttons)||{}),
   });
  },
  async cancel(t:TransportTarget,messageId:number):Promise<void>{
   assertTarget(t);
   if(!Number.isSafeInteger(messageId)||messageId<=0)throw new Error("MPB_MESSAGE_ID_INVALID");
   await telegram.deleteMessage(t.chatId,messageId);
  },
 };
}
