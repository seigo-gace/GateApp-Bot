/** GayBBS is only the two-choice launcher. Content ownership stays in CreateVdobot.
 * Destinations are read from the existing verified menu registry, never guessed.
 */
import {Markup} from "telegraf";
import {pool} from "../db/index.js";

export type CreatorDestination={label:string;url:string};
export async function verifiedCreatorDestinations(chatId:number):Promise<ReadonlyMap<"video"|"sticker",string>>{
 const result=await pool.query<{label:string;destination_url:string}>(
  `SELECT label,destination_url FROM board_posting_menu_links
   WHERE chat_id=$1 AND enabled=TRUE AND verified_by IS NOT NULL
   AND verified_at IS NOT NULL AND label=ANY($2::text[])`,
  [chatId,["クリエーター有料ビデオ投稿","動画","ステッカー/絵文字"]]);
 const urls=new Map<"video"|"sticker",string>();
 for(const entry of result.rows){
  const kind=entry.label==="ステッカー/絵文字"?"sticker":"video";
  try{
   const parsed=new URL(entry.destination_url);
   if(parsed.protocol!=="https:"||parsed.hostname!=="t.me"||
    !/^\/[A-Za-z][A-Za-z0-9_]{4,31}$/.test(parsed.pathname)||
    !/^\/?start=/.test(parsed.search))continue;
   urls.set(kind,parsed.toString());
  }catch{/* Not a verified Telegram bot link. */}
 }
 return urls;
}
export function creatorPostingKeyboard(urls:ReadonlyMap<"video"|"sticker",string>){
 const button=(name:string,kind:"video"|"sticker")=>{
  const link=urls.get(kind);
  return link?Markup.button.url(name,link):
   Markup.button.callback(name,"dm:creator-unavailable:"+kind);
 };
 return Markup.inlineKeyboard([
  [button("動画","video"),button("ステッカー/絵文字","sticker")],
  [Markup.button.callback("🔙 戻る","dm:chat-back")]
 ]);
}
export const CREATOR_POSTING_TEXT=
 "🎨 クリエーター用投稿\n\n投稿したい種類を選んでください。\n\n"+
 "「動画」：動画の登録・管理へ進みます。\n"+
 "「ステッカー/絵文字」：パック作成・素材追加・編集へ進みます。\n\n"+
 "選んだ後の操作はCreateVdobotで行います。";
