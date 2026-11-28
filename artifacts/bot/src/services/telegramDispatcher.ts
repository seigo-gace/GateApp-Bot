/** Adapter of existing -AdminSystem/multipost/dispatcher.ts.
 * Owns Telegram delivery mechanics only; business state stays with Source.
 * Bot API ambiguity is NOT retried here.
 */
import type {Telegram} from "telegraf";
import {Markup} from "telegraf";
import {assertTelegramInlineKeyboard} from "./telegramClientCompatibility.js";
import {publicNavigationButton} from "./startlessNavigation.js";
export type TransportTarget={chatId:number;threadId:number};
export type TransportButton={text:string;url?:string;callback_data?:string;copy_text?:{text:string};style?:"primary"|"success"|"danger"};
export type TransportMessage={text:string;parseMode?:"HTML"|"MarkdownV2";media?:readonly {kind:"photo"|"video"|"sticker";fileId:string}[];buttons?:readonly (readonly TransportButton[])[]};
function assertTarget(t:TransportTarget):void{
 if(!Number.isSafeInteger(t.chatId)||t.chatId>=0||
    !Number.isSafeInteger(t.threadId)||t.threadId<=0)
  throw new Error("MPB_TARGET_UNVERIFIED");
}
function markup(buttons:TransportMessage["buttons"]){
 if(!buttons?.length)return undefined;
 const rows=buttons.map(row=>row.map(raw=>{
  const x=publicNavigationButton(raw);
  return ({
  text:x.text,
  ...(x.copy_text?{copy_text:x.copy_text}:x.callback_data?{callback_data:x.callback_data}:{url:x.url}),
  ...(x.style?{style:x.style}:{})
 });
 }));
 const keyboard=Markup.inlineKeyboard(rows as unknown as Parameters<typeof Markup.inlineKeyboard>[0]);
 assertTelegramInlineKeyboard(keyboard);
 return keyboard;
}
export function createTelegramDispatcher(telegram:Telegram){
 return {
  async publish(t:TransportTarget,message:TransportMessage):Promise<number>{
   assertTarget(t);
   const media=message.media??[];
   if(media.length>5)throw Error("ANNOUNCEMENT_MEDIA_LIMIT");
   if(media.length===1&&media[0]!.kind!=="sticker"&&message.text.length<=1024){
    const one=media[0]!;
    const opts={message_thread_id:t.threadId,caption:message.text,
     ...(message.parseMode?{parse_mode:message.parseMode}:{}),
     ...(markup(message.buttons)||{})};
    const sent=one.kind==="photo"?
      await telegram.sendPhoto(t.chatId,one.fileId,opts):
      await telegram.sendVideo(t.chatId,one.fileId,opts);
    return sent.message_id;
   }
   const sent=await telegram.sendMessage(t.chatId,message.text,{
    message_thread_id:t.threadId,
    ...(message.parseMode?{parse_mode:message.parseMode}:{}),
    ...(markup(message.buttons)||{}),
   });
   // Native stickers are not valid album members and cannot carry captions.
   // Preserve their file type and sequence; only contiguous photos/videos form albums.
   for(let i=0;i<media.length;){
    const one=media[i]!;
    if(one.kind==="sticker"){
     await telegram.sendSticker(t.chatId,one.fileId,{message_thread_id:t.threadId});
     i++;continue;
    }
    let end=i+1;
    while(end<media.length&&media[end]!.kind!=="sticker")end++;
    const batch=media.slice(i,end);
    if(batch.length===1){
     if(one.kind==="photo")await telegram.sendPhoto(t.chatId,one.fileId,{message_thread_id:t.threadId});
     else await telegram.sendVideo(t.chatId,one.fileId,{message_thread_id:t.threadId});
    }else await telegram.sendMediaGroup(t.chatId,
     batch.map(x=>({type:x.kind,media:x.fileId})) as Parameters<typeof telegram.sendMediaGroup>[1],
     {message_thread_id:t.threadId});
    i=end;
   }
   return sent.message_id;
  },
  async revise(t:TransportTarget,messageId:number,message:TransportMessage):Promise<void>{
   assertTarget(t);
   if(!Number.isSafeInteger(messageId)||messageId<=0)throw new Error("MPB_MESSAGE_ID_INVALID");
   try{
    await telegram.editMessageText(t.chatId,messageId,undefined,message.text,{
     ...(message.parseMode?{parse_mode:message.parseMode}:{}),
     ...(markup(message.buttons)||{}),
    });
   }catch(error){
    // Telegram returns 400 if the published text/keyboard already matches.
    // This is an idempotent success: do not mark the original panel uncertain
    // or create a replacement public message.
    if(error instanceof Error&&/message is not modified/i.test(error.message))return;
    throw error;
   }
  },
  async cancel(t:TransportTarget,messageId:number):Promise<void>{
   assertTarget(t);
   if(!Number.isSafeInteger(messageId)||messageId<=0)throw new Error("MPB_MESSAGE_ID_INVALID");
   await telegram.deleteMessage(t.chatId,messageId);
  },
 };
}
