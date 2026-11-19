/** Cross-client Telegram Bot API compatibility contract.
 * Telegram Bot API does not expose the user's OS/client version in callback updates.
 * Never assume platform from username, language, device or callback data.
 * Keep all approved visible labels, row layouts and button colors unchanged.
 */
export const TELEGRAM_CLIENT_TARGETS=[
 "ios","ipados","android","windows","macos"
] as const;
export type TelegramClientTarget=typeof TELEGRAM_CLIENT_TARGETS[number];
export type ClientAcceptance="NOT_VERIFIED"|"VERIFIED"|"FAILED";
/** A target declaration is not live device acceptance. */
export const TELEGRAM_CLIENT_ACCEPTANCE:Readonly<Record<TelegramClientTarget,ClientAcceptance>>={
 ios:"NOT_VERIFIED",ipados:"NOT_VERIFIED",android:"NOT_VERIFIED",
 windows:"NOT_VERIFIED",macos:"NOT_VERIFIED",
};
export type TelegramButtonAction={
 callback_data?:unknown;
 url?:unknown;
 copy_text?:unknown;
 web_app?:unknown;
 switch_inline_query?:unknown;
 switch_inline_query_current_chat?:unknown;
};
const utf8Bytes=(v:string)=>Buffer.byteLength(v,"utf8");
/** Stateless guard reused by DM wizards and public panel publication.
 * This validates Bot API transport; it is NOT a substitute for device tests.
 */
export function assertTelegramInlineButton(button:unknown):void{
 if(!button||typeof button!=="object")throw new Error("INLINE_BUTTON_INVALID");
 const b=button as TelegramButtonAction&{text?:unknown};
 if(typeof b.text!=="string"||!b.text.trim())throw new Error("INLINE_BUTTON_TEXT_INVALID");
 const keys=["callback_data","url","copy_text","web_app","switch_inline_query","switch_inline_query_current_chat"] as const;
 const active=keys.filter(k=>b[k]!==undefined);
 if(active.length!==1)throw new Error("INLINE_BUTTON_ACTION_AMBIGUOUS");
 const key=active[0];
 if(key==="callback_data"){
  if(typeof b.callback_data!=="string"||utf8Bytes(b.callback_data)<1||utf8Bytes(b.callback_data)>64)
   throw new Error("INLINE_CALLBACK_BYTES_INVALID");
 }else if(key==="url"){
  if(typeof b.url!=="string"||!b.url.length||!(/^(https:\/\/|tg:\/\/)/.test(b.url)))
   throw new Error("INLINE_LINK_INVALID");
 }else if(key==="copy_text"){
  const value=b.copy_text as {text?:unknown}|null;
  if(!value||typeof value.text!=="string"||[...value.text].length<1||[...value.text].length>256)
   throw new Error("INLINE_COPY_TEXT_INVALID");
 }
}
export function assertTelegramInlineKeyboard(keyboard:unknown):void{
 if(!keyboard||typeof keyboard!=="object")throw new Error("INLINE_KEYBOARD_INVALID");
 const k=keyboard as {reply_markup?:{inline_keyboard?:unknown}};
 const rows=k.reply_markup?.inline_keyboard;
 if(!Array.isArray(rows)||rows.length===0)throw new Error("INLINE_KEYBOARD_INVALID");
 for(const row of rows){
  if(!Array.isArray(row)||row.length===0)throw new Error("INLINE_KEYBOARD_EMPTY_ROW");
  for(const cell of row)assertTelegramInlineButton(cell);
 }
}
/** URL/deep link and callback are distinct transports.
 * A start payload may show Telegram's native Start button even for an existing DM.
 */
export const TELEGRAM_ENTRY_TRANSPORT={
 public_to_dm:"deep_link",
 dm_internal:"callback_query",
} as const;
