/** Recruitment contact goes directly to the owner's public Telegram username.
 * Do not create application sessions, timers, or an alternate Bot DM gate.
 */
import type {Telegram} from "telegraf";
export function publicUsernameLink(username:unknown):string{
 if(typeof username!=="string"||!/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username))
  throw Error("RECRUITMENT_OWNER_USERNAME_REQUIRED");
 const normalized=username.replace(/^@/,"");
 return "https://t.me/"+normalized;
}
export async function ownerUsernameLink(telegram:Telegram,userId:number):Promise<string>{
 const chat=await telegram.getChat(userId);
 const username="username" in chat?chat.username:undefined;
 return publicUsernameLink(username);
}
