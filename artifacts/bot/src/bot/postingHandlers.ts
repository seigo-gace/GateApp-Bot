import { Markup, type Telegraf } from "telegraf";
import { getProfile } from "../services/profileRepository.js";
import { renderPublicProfile } from "../services/profileCore.js";
import { listVerifiedTopics } from "../services/postingDelivery.js";
import { publishPost } from "../services/publishService.js";
import { buildRoomCard, buildAnnouncementCard, validateAnnouncement,
  validateRoom,assertHttpsMeetingUrl,type AnnouncementKind } from "../services/postingDomain.js";
import { beginDraft,getDraft,getWaitingDraft,updateDraft,createRoom,
 createAnnouncement,markDraftPublished,type PostModule,type EditorDraft } from "../services/publicPostRepository.js";
import type { PostPurpose } from "../services/topicRouting.js";

type Module="profile"|"room"|"announcement";
const LABELS:Record<Module,string>={profile:"プロフィール",room:"ROOM",announcement:"告知・募集"};
function privateDM(ctx:{chat?:{type:string}}):boolean{return ctx.chat?.type==="private";}
function preview(module:Module,draft:EditorDraft):string {
 if(module==="room"){
  const title=String(draft.data.title||"");
  const url=draft.data.externalUrl ? String(draft.data.externalUrl) : undefined;
  return buildRoomCard(validateRoom({ownerId:1,name:title,mode:url?"external":"jitsi",
   externalUrl:url,status:"ready"}),url||"");
 }
 const kind=draft.data.kind as AnnouncementKind;
 return buildAnnouncementCard(validateAnnouncement({ownerId:1,kind,
  text:String(draft.data.text||"")}));
}
async function destinationMenu(ctx:{reply:Function},module:Module,revision:number):Promise<void>{
 const options=await listVerifiedTopics(module as PostPurpose);
 if(!options.length){
  await ctx.reply("投稿先の実Topic IDがまだ確認されていません。管理者によるトピック接続後に公開できます。下書きは保持しています。");
  return;
 }
 await ctx.reply("投稿先を選択してください。グループへの投稿はまだ行いません。",
  Markup.inlineKeyboard(options.slice(0,30).map(t=>[
   Markup.button.callback(t.title+" / "+t.board,
    `post:choose:${module}:${revision}:${t.id}`)])));
}
export function registerPostingHandlers(bot:Telegraf):void{
 bot.command("publishprofile",async ctx=>{
  if(!privateDM(ctx))return;
  const p=await getProfile(ctx.from.id);
  if(!p){await ctx.reply("先に /profile で登録してください。");return;}
  await destinationMenu(ctx,"profile",p.revision);
 });
 bot.command("room",async ctx=>{
  if(!privateDM(ctx))return;
  await beginDraft(ctx.from.id,"room","awaiting_text");
  await ctx.reply("🎬 ROOM名を入力してください。持込URLを使う場合は「ROOM名 | https://...」と1通で送れます。URL省略時はJitsiを生成します。");
 });
 bot.command("announce",async ctx=>{
  if(!privateDM(ctx))return;
  const draft=await beginDraft(ctx.from.id,"announcement","awaiting_kind");
  await ctx.reply("📢 投稿の種類を選択してください。",
   Markup.inlineKeyboard([
    [Markup.button.callback("告知",`post:kind:${draft.revision}:announcement`)],
    [Markup.button.callback("予告",`post:kind:${draft.revision}:preview`)],
    [Markup.button.callback("募集",`post:kind:${draft.revision}:recruitment`)],
   ]));
 });
 bot.action(/^post:kind:(\d+):(announcement|preview|recruitment)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const rev=Number(ctx.match[1]);const kind=ctx.match[2] as AnnouncementKind;
  const draft=await getDraft(ctx.from.id,"announcement");
  if(!draft||draft.revision!==rev||draft.step!=="awaiting_kind"){
   await ctx.answerCbQuery("古い操作です。/announce で再開してください。");return;
  }
  await updateDraft(ctx.from.id,"announcement",rev,"awaiting_text",{kind});
  await ctx.answerCbQuery();
  await ctx.reply(kind==="preview"?
   "予告文を送ってください。開催日時は公開前に別途必要です。":
   "本文を1通で送ってください。公開前に内容と投稿先を確認します。");
 });
 bot.on("text",async(ctx,next)=>{
  if(!privateDM(ctx)||ctx.message.text.startsWith("/"))return next();
  const current=await getWaitingDraft(ctx.from.id);
  if(!current)return next();
  const input=ctx.message.text.trim();
  try{
   let data:Record<string,unknown>;
   if(current.module==="room"){
    const parts=input.split(" | ");
    if(parts.length>2)throw new Error("ROOM名とURLは「 | 」で区切ってください。");
    const name=parts[0]?.trim()||"";
    const externalUrl=parts.length===2?assertHttpsMeetingUrl(parts[1]!):undefined;
    validateRoom({ownerId:ctx.from.id,name,mode:externalUrl?"external":"jitsi",
     externalUrl,status:"ready"});
    data={title:name,externalUrl:externalUrl||null};
   }else{
    if(!current.data.kind)throw new Error("投稿種別が未選択です。");
    const kind=current.data.kind as AnnouncementKind;
    if(kind==="preview")throw new Error("予告は開催日時の入力が必要です。日時設定対応までは公開を保留しています。");
    validateAnnouncement({ownerId:ctx.from.id,kind,text:input});
    data={...current.data,text:input};
   }
   const updated=await updateDraft(ctx.from.id,current.module,current.revision,"preview",data);
   await ctx.reply("プレビュー（まだ投稿していません）\n"+preview(current.module,updated));
   await destinationMenu(ctx,current.module,updated.revision);
  }catch(e){
   await ctx.reply(e instanceof Error?e.message:"入力内容を確認してください。");
  }
 });
 bot.action(/^post:choose:(profile|room|announcement):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const module=ctx.match[1] as Module;
  const rev=Number(ctx.match[2]);const topicId=Number(ctx.match[3]);
  try{
   let text:string;
   if(module==="profile"){
    const p=await getProfile(ctx.from.id);
    if(!p||p.revision!==rev)throw new Error("プロフィールが更新されています。やり直してください。");
    text=renderPublicProfile(p);
   }else{
    const d=await getDraft(ctx.from.id,module as PostModule);
    if(!d||d.step!=="preview"||d.revision!==rev)throw new Error("下書きが更新されています。");
    text=preview(module,d);
   }
   await ctx.answerCbQuery();
   await ctx.editMessageText(
    "公開確認：\n"+text+"\n\n投稿先を確認し、公開を希望する場合だけボタンを押してください。",
    {parse_mode:"HTML",...Markup.inlineKeyboard([
     [Markup.button.callback("✅ この内容を公開",`post:publish:${module}:${rev}:${topicId}`)],
     [Markup.button.callback("キャンセル（非公開のまま）","post:cancel")],
    ])}
   );
  }catch(e){await ctx.answerCbQuery("対象を確認できません。最初からやり直してください。");}
 });
 bot.action("post:cancel",async ctx=>{
  if(!privateDM(ctx))return;
  await ctx.answerCbQuery("公開しません");
  await ctx.editMessageText("公開は取り消しました。下書きは保存されています。");
 });
 bot.action(/^post:publish:(profile|room|announcement):(\d+):(\d+)$/,async ctx=>{
  if(!privateDM(ctx))return;
  const module=ctx.match[1] as Module;
  const revision=Number(ctx.match[2]);const topicId=Number(ctx.match[3]);
  await ctx.answerCbQuery("公開処理を確認しています");
  try{
   let sourceId:string;let text:string;
   if(module==="profile"){
    const p=await getProfile(ctx.from.id);
    if(!p||p.revision!==revision)throw new Error("プロフィールが更新されています。");
    sourceId=String(ctx.from.id);text=renderPublicProfile(p);
   }else{
    const draft=await getDraft(ctx.from.id,module);
    if(!draft||draft.step!=="preview"||draft.revision!==revision)
     throw new Error("投稿下書きが変更されています。");
    if(module==="room"){
     const name=String(draft.data.title);
     const url=draft.data.externalUrl?String(draft.data.externalUrl):undefined;
     const room=await createRoom(ctx.from.id,revision,name,url);
     sourceId=room.sourceId;
     text=preview(module,draft)+"\n"+
      "🔗 <a href=\""+room.joinUrl.replace(/&/g,"&amp;").replace(/"/g,"&quot;")+"\">ROOMへ参加</a>";
    }else{
     const kind=draft.data.kind as AnnouncementKind;
     const value=String(draft.data.text);
     const ann=await createAnnouncement(ctx.from.id,revision,kind,value);
     sourceId=ann.sourceId;text=buildAnnouncementCard({ownerId:ctx.from.id,kind,text:value});
    }
   }
   const result=await publishPost(ctx.telegram,{
    sourceType:module,sourceId,ownerId:ctx.from.id,revision,topicId,text,approved:true,
   });
   if(module!=="profile")await markDraftPublished(ctx.from.id,module,revision);
   await ctx.editMessageText("✅ 投稿済み\n投稿先："+result.chatId+
    " / Topic "+result.threadId+"\n投稿ID："+result.messageId);
  }catch(e){
   const msg=e instanceof Error?e.message:"投稿失敗";
   await ctx.reply(msg==="PUBLISH_NEEDS_RECONCILE"?
    "送信結果の照合が必要です。重複投稿防止のため自動再送は行いません。":
    "投稿を確認できませんでした："+msg);
  }
 });
}
