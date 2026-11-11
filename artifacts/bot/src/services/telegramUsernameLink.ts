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

/** Used only after the applicant submits to this specific owner. Telegram may
 * restrict opening an ID-based chat according to the applicant's privacy settings.
 */
export function applicantDmLink(userId:number,username?:unknown):string{
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error("APPLICANT_ID_INVALID");
 if(typeof username==="string"&&/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username))
  return publicUsernameLink(username);
 return "tg://user?id="+userId;
}
