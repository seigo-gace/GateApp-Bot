/** Adapter of existing -AdminSystem/multipost/dispatcher.ts.
 * Owns Telegram delivery mechanics only; business state stays with Source.
 * Bot API ambiguity is NOT retried here.
 */
import type {Telegram} from "telegraf";
import {Markup} from "telegraf";
export type TransportTarget={chatId:number;threadId:number};
export type TransportMessage={text:string;parseMode?:"HTML"|"MarkdownV2";media?:readonly {kind:"photo"|"video";fileId:string}[];buttons?:readonly (readonly {text:string;url:string;copy_text?:{text:string};style?:"primary"|"success"|"danger"}[])[]};
function assertTarget(t:TransportTarget):void{
 if(!Number.isSafeInteger(t.chatId)||t.chatId>=0||
    !Number.isSafeInteger(t.threadId)||t.threadId<=0)
  throw new Error("MPB_TARGET_UNVERIFIED");
}
function markup(buttons:TransportMessage["buttons"]){
 if(!buttons?.length)return undefined;
 const rows=buttons.map(row=>row.map(x=>({
  text:x.text,
  ...(x.copy_text?{copy_text:x.copy_text}:{url:x.url}),
  ...(x.style?{style:x.style}:{})
 })));
 return Markup.inlineKeyboard(rows as unknown as Parameters<typeof Markup.inlineKeyboard>[0]);
}
export function createTelegramDispatcher(telegram:Telegram){
 return {
  async publish(t:TransportTarget,message:TransportMessage):Promise<number>{
   assertTarget(t);
   const media=message.media??[];
   if(media.length>5)throw Error("ANNOUNCEMENT_MEDIA_LIMIT");
   if(media.length===1&&message.text.length<=1024){
    const one=media[0]!;
    const opts={message_thread_id:t.threadId,
     caption:message.text,...(message.parseMode?{parse_mode:message.parseMode}:{}),
     ...(markup(message.buttons)||{})};
    const sent=one.kind==="photo"?
      await telegram.sendPhoto(t.chatId,one.fileId,opts):
      await telegram.sendVideo(t.chatId,one.fileId,opts);
    return sent.message_id;
   }
   // A Telegram album cannot carry reply_markup. Send the primary action
   // message once; any partial/ambiguous album send is reconciled, not retried.
   const sent=await telegram.sendMessage(t.chatId,message.text,{
    message_thread_id:t.threadId,
    ...(message.parseMode?{parse_mode:message.parseMode}:{}),
    ...(markup(message.buttons)||{}),
   });
   if(media.length===1){
    const one=media[0]!;
    if(one.kind==="photo")await telegram.sendPhoto(t.chatId,one.fileId,{message_thread_id:t.threadId});
    else await telegram.sendVideo(t.chatId,one.fileId,{message_thread_id:t.threadId});
   }else if(media.length>=2){
    await telegram.sendMediaGroup(t.chatId,
     media.map(x=>({type:x.kind,media:x.fileId})) as Parameters<typeof telegram.sendMediaGroup>[1],
     {message_thread_id:t.threadId});
   }
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
