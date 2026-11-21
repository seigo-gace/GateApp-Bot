/** Group-public navigation without repeating Telegram /start after first activation.
 * The payload remains an opaque private state token; never expose it as text.
 * First-contact gate/online links retain their one-time onboarding semantics.
 */
export const STARTLESS_BOT="GayBBS_bot";
export const STARTLESS_PREFIX="gdm:";
const permitted=/^(?:[mprja]_[A-Za-z0-9_-]{16,48}|(?:pv|pm|pt)_[A-Za-z0-9_-]{32}|search|help|bugreport|talk|invite|link)$/;
export function startlessPayload(url:string):string|null{
 let u:URL;
 try{u=new URL(url);}catch{return null;}
 if(u.protocol!=="https:"||!["t.me","telegram.me"].includes(u.hostname)||
   u.pathname.toLowerCase()!=="/"+STARTLESS_BOT.toLowerCase()||u.hash||
   u.searchParams.size!==1)return null;
 const payload=u.searchParams.get("start");
 return payload&&permitted.test(payload)?payload:null;
}
export function publicNavigationButton<T extends {text:string;url?:string;callback_data?:string;copy_text?:unknown;style?:string}>(
 button:T
):T{
 if(!button.url||button.copy_text)return button;
 const payload=startlessPayload(button.url);
 if(payload)return {...button,url:undefined,callback_data:STARTLESS_PREFIX+payload};
 if(button.url==="https://t.me/CreateVdobot?start=creator")
  return {...button,url:"https://t.me/CreateVdobot"};
 return button;
}
export function callbackStartlessPayload(data:string):string|null{
 if(!data.startsWith(STARTLESS_PREFIX))return null;
 const payload=data.slice(STARTLESS_PREFIX.length);
 return permitted.test(payload)?payload:null;
}
