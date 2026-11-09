/** Menu entry identity: opaque, server-created, and resolved only from DB.
 * A Telegram deep link must NEVER accept raw chat ID / thread ID from a user.
 */
import { createHash, randomBytes } from "node:crypto";
export const MENU_FEATURES=["profile","announcement","room","link","search","help"] as const;
export type MenuFeature=typeof MENU_FEATURES[number];
export type MenuOrigin={chatId:number;threadId:number;panelId:number;feature:MenuFeature};
export function newMenuToken():string {
 return randomBytes(24).toString("base64url");
}
export function tokenHash(token:string):string{
 if(!/^[A-Za-z0-9_-]{32}$/.test(token))throw new Error("MENU_TOKEN_INVALID");
 return createHash("sha256").update("GayBBS-menu-v1:").update(token).digest("hex");
}
export function decodeMenuStartPayload(payload:string):string{
 const match=/^[mr]_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match)throw new Error("MENU_START_INVALID");
 return match[1]!;
}
export function assertMenuOrigin(o:MenuOrigin):void{
 if(!Number.isSafeInteger(o.chatId)||o.chatId>=0||
    !Number.isSafeInteger(o.threadId)||o.threadId<=0||
    !Number.isSafeInteger(o.panelId)||o.panelId<0||
    !MENU_FEATURES.includes(o.feature))throw new Error("MENU_ORIGIN_INVALID");
}
