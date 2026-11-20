import {Markup,type Telegraf} from "telegraf";
import {getProfile,listProfilePublications} from "../services/profileRepository.js";
import {renderPublicProfile,escapeProfileHtml} from "../services/profileCore.js";
import {hidePublishedProfile} from "../services/profilePublicationControl.js";
import {startProfileEditor} from "./profileHandlers.js";

const privateDM=(ctx:{chat?:{type:string};from?:{id:number}})=>
 ctx.chat?.type==="private"&&!!ctx.from;
const targetId=(chatId:number,threadId:number)=>chatId+":"+threadId;
export function registerProfilePostManagement(bot:Telegraf):void{
 bot.command("myprofileposts",async ctx=>{
  if(!privateDM(ctx))return;
  const pubs=await listProfilePublications(ctx.from.id);
  if(!pubs.length){await ctx.reply("公開済みプロフィール投稿はありません。/profile で登録できます。");return;}
  const rows=pubs.map(p=>[
   Markup.button.callback("投稿 "+targetId(p.chatId,p.threadId)+"（"+p.status+"）",
    "pfpost:detail:"+targetId(p.chatId,p.threadId)),
  ]);
  await ctx.reply("🪪 マイ投稿｜プロフィール\n編集・コピー・転送用出力・非公開・削除は本人専用です。"+
   "\n公開先ごとの投稿を選んでください。",Markup.inlineKeyboard(rows));
 });
 bot.action(/^pfpost:detail:(-\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const chatId=Number(ctx.match[1]),threadId=Number(ctx.match[2]);
  const row=(await listProfilePublications(ctx.from.id)).find(
   p=>p.chatId===chatId&&p.threadId===threadId);
  if(!row){await ctx.answerCbQuery("対象の投稿がありません");return;}
  const p=await getProfile(ctx.from.id);
  if(!p){await ctx.answerCbQuery("プロフィールがありません");return;}
  await ctx.answerCbQuery();
  await ctx.editMessageText(
   "🪪 マイ投稿｜"+chatId+" / "+threadId+"\n投稿状態："+row.status+
   "\n以下は現在の保存内容です。公開済みの表示と異なる場合があります。\n"+
   renderPublicProfile(p),
   {parse_mode:"HTML",...Markup.inlineKeyboard([
    [Markup.button.callback("編集","pfpost:edit:"+targetId(chatId,threadId)),
     Markup.button.callback("コピー","pfpost:copy:"+targetId(chatId,threadId))],
    [Markup.button.callback("転送用出力","pfpost:share:"+targetId(chatId,threadId))],
    [Markup.button.callback("非公開","pfpost:confirm:unpublish:"+targetId(chatId,threadId)),
     Markup.button.callback("削除","pfpost:confirm:delete:"+targetId(chatId,threadId))],
   ])});
 });
 bot.action(/^pfpost:(edit|copy|share):(-\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const action=ctx.match[1],chatId=Number(ctx.match[2]),threadId=Number(ctx.match[3]);
  const exists=(await listProfilePublications(ctx.from.id)).some(
   p=>p.chatId===chatId&&p.threadId===threadId);
  if(!exists){await ctx.answerCbQuery("対象の投稿がありません");return;}
  await ctx.answerCbQuery();
  if(action==="edit"){
   await startProfileEditor(ctx);
   return;
  }
  const p=await getProfile(ctx.from.id);
  if(!p){await ctx.reply("プロフィールがありません。");return;}
  await ctx.reply((action==="share"?
   "📨 転送用に再構成した内容です。Telegramの転送制限はそのまま適用されます。\n":
   "📋 コピー用プロフィールです。本文を選択してコピーしてください。\n")+
   renderPublicProfile(p),{parse_mode:"HTML"});
 });
 bot.action(/^pfpost:confirm:(unpublish|delete):(-\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const mode=ctx.match[1],chatId=Number(ctx.match[2]),threadId=Number(ctx.match[3]);
  const pub=(await listProfilePublications(ctx.from.id)).find(
   p=>p.chatId===chatId&&p.threadId===threadId&&p.status==="published");
  if(!pub){await ctx.answerCbQuery("この投稿は操作できません");return;}
  await ctx.answerCbQuery();
  await ctx.editMessageText(
   mode==="delete"?
    "この公開プロフィールの元投稿を削除します。本人プロフィールの保存データは保持します。削除しますか？":
    "この公開プロフィールの表示を非公開にします。本人プロフィールの保存データは保持します。実行しますか？",
   Markup.inlineKeyboard([
    [Markup.button.callback("実行する","pfpost:execute:"+mode+":"+targetId(chatId,threadId))],
    [Markup.button.callback("戻る","pfpost:detail:"+targetId(chatId,threadId))],
   ]));
 });
 bot.action(/^pfpost:execute:(unpublish|delete):(-\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const mode=ctx.match[1] as "unpublish"|"delete";
  await ctx.answerCbQuery("処理を確認しています");
  try{
   await hidePublishedProfile(ctx.telegram,ctx.from.id,Number(ctx.match[2]),Number(ctx.match[3]),mode);
   await ctx.editMessageText("✅ 公開元投稿の処理が完了しました。保存済みプロフィールは保持しています。");
  }catch{
   await ctx.editMessageText(
    "公開元投稿の処理は完了確認できません。二重操作せず、投稿状態の照合が必要です。");
  }
 });
}
