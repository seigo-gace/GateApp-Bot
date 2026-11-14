/** GayBBS owns only the launch menu. The already-installed CreateVdobot
 * owns both subsequent private editors; no new sales/sticker implementation.
 */
import {Markup} from "telegraf";

export const CREATOR_DESTINATIONS={
 video:"https://t.me/CreateVdobot?start=video",
 sticker:"https://t.me/CreateVdobot?start=sticker",
} as const;

export function creatorPostingKeyboard(){
 return Markup.inlineKeyboard([
  [Markup.button.url("動画",CREATOR_DESTINATIONS.video),
   Markup.button.url("ステッカー/絵文字",CREATOR_DESTINATIONS.sticker)],
  [Markup.button.callback("🔙 戻る","dm:chat-back")]
 ]);
}
export const CREATOR_POSTING_TEXT=
 "🎨 クリエーター用投稿\n\n投稿する種類を選んでください。\n\n"+
 "🎬 動画：動画の投稿・管理へ進みます。\n"+
 "🎨 ステッカー/絵文字：パックの作成・追加・編集へ進みます。\n\n"+
 "選択するとCreateVdobotが開きます。";
