import type {Telegram} from "telegraf";

/** Allowlisted adapter over the already-running GroupBot's authenticated
 * Telegraf client. No second Bot token, connection, poller or Userbot.
 */
export function createStickerPinTelegrafApi(telegram:Pick<Telegram,
 "getMe"|"getChatMember"|"sendMessage"|"pinChatMessage">){
 if(!telegram||typeof telegram.getMe!=="function"||
    typeof telegram.sendMessage!=="function"||
    typeof telegram.pinChatMessage!=="function")
   throw new Error("STICKER_PIN_GROUP_TRANSPORT_MISSING");
 return async(method:string,args:Record<string,unknown>):Promise<unknown>=>{
  if(method==="getMe")return telegram.getMe();
  if(method==="getChatMember"){
   if(!Number.isSafeInteger(args.chat_id)||!Number.isSafeInteger(args.user_id))
    throw new Error("STICKER_PIN_CHAT_MEMBER_ARGS_INVALID");
   return telegram.getChatMember(Number(args.chat_id),Number(args.user_id));
  }
  if(method==="sendMessage"){
   const chatId=Number(args.chat_id),threadId=Number(args.message_thread_id);
   if(!Number.isSafeInteger(chatId)||chatId>=0||
      !Number.isSafeInteger(threadId)||threadId<=0||
      typeof args.text!=="string"||
      !Array.isArray((args.reply_markup as {inline_keyboard?:unknown})?.inline_keyboard))
    throw new Error("STICKER_PIN_SEND_ARGS_INVALID");
   const keyboard=args.reply_markup as {inline_keyboard:{text:string;url:string}[][]};
   return telegram.sendMessage(chatId,args.text,{
    message_thread_id:threadId,reply_markup:keyboard
   });
  }
  if(method==="pinChatMessage"){
   const chatId=Number(args.chat_id),msgId=Number(args.message_id);
   if(!Number.isSafeInteger(chatId)||chatId>=0||
      !Number.isSafeInteger(msgId)||msgId<=0)
    throw new Error("STICKER_PIN_PIN_ARGS_INVALID");
   return telegram.pinChatMessage(chatId,msgId,{disable_notification:true});
  }
  throw new Error("STICKER_PIN_METHOD_NOT_ALLOWED");
 };
}
