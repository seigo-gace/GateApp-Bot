/** DM invitation panel. Copy buttons use official Telegram Bot API copy_text.
 * Copying a Gate URL never grants membership; recipients complete their own Gate.
 */
import {Markup} from "telegraf";
import type {CommunityInviteChoice} from "../modules/gaybbsApproval/handlers.js";

export function invitationCopyButton(label:string,url:string){
 if(!/^https:\/\/t\.me\/GayBBS_bot\?start=gate_[A-Za-z0-9_-]{1,48}$/.test(url))
  throw new Error("INVITE_COPY_GATE_URL_INVALID");
 return {text:label,copy_text:{text:url}} as unknown as ReturnType<typeof Markup.button.url>;
}

export function invitationMenu(
 approved:boolean,choices:readonly CommunityInviteChoice[],
){
 if(choices.length!==3||new Set(choices.map(x=>x.chatId)).size!==3)
  throw new Error("INVITE_THREE_BOARD_MAPPING_REQUIRED");
 const rows=choices.map(choice=>{
  const entry=approved&&choice.joined?choice.directUrl:choice.gateUrl;
  return [
   Markup.button.url(choice.label,entry),
   invitationCopyButton("🔗 コピー",choice.gateUrl),
  ];
 });
 return Markup.inlineKeyboard([...rows,[Markup.button.callback("🔙 戻る","dm:chat-back")]]);
}

export function invitationText(approved:boolean):string{
 return approved
  ?"🔗 紹介/招待\n承認済みです。参加済みグループは直接開けます。未参加グループは既存Gateで参加リンクを受け取れます。\n「🔗 コピー」は、紹介する相手が承認質問から進めるリンクをコピーします。"
  :"🔗 紹介/招待\n参加する場合はグループを選択して承認質問Gateへ進んでください。\n「🔗 コピー」は同じ参加案内リンクをコピーします。受け取った方にも承認質問が必要です。";
}
