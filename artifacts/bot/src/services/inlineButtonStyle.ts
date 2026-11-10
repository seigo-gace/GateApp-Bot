/** Telegram inline-button colors reused by recruitment and ROOM.
 * The client chooses final rendering for supported primary/success/danger.
 */
import {Markup} from "telegraf";
export function styledInlineButton(text:string,id:string,style?:"primary"|"success"|"danger"){
 return {...Markup.button.callback(text,id),...(style?{style}:{})};
}
