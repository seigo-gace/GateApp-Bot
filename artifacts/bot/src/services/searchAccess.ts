/** Group visibility boundary for read-only search from private Bot DMs.
 * A Telegram user can see results only from groups they currently belong to.
 * Every network error fails closed. Never infer membership from a menu token.
 */
import type {Telegram} from "telegraf";
import {BOARD_GROUP_CHAT_IDS} from "./topicRouting.js";

export function canReadGroupMembership(member:{status:string;is_member?:boolean}):boolean{
 return member.status==="creator"||member.status==="administrator"||
  member.status==="member"||(member.status==="restricted"&&member.is_member===true);
}
export async function authorizedSearchGroupIds(
 telegram:Pick<Telegram,"getChatMember">,userId:number
):Promise<number[]>{
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error("SEARCH_USER_INVALID");
 const ids=Object.values(BOARD_GROUP_CHAT_IDS);
 const allowed=await Promise.all(ids.map(async chatId=>{
  try{
   const member=await telegram.getChatMember(chatId,userId);
   return canReadGroupMembership(member)?chatId:null;
  }catch{return null;}
 }));
 return allowed.filter((id):id is number=>id!==null);
}
