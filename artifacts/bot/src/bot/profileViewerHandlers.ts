import {Markup,type Context,type Telegraf} from "telegraf";
import {renderPublicProfile,escapeProfileHtml} from "../services/profileCore.js";
import {LIKE_CATEGORIES} from "../services/profileLike.js";
import {parseProfileViewerPayload,profileViewerUrl,resolvePublishedProfileView,
 type ViewerPurpose} from "../services/profilePublicView.js";
import type {SavedProfile} from "../services/profileRepository.js";
import {PROFILE_ALBUM_LIMIT} from "../services/profileMedia.js";

type ProfileMedia={itemId?:number;fileId:string;type:"photo"|"video"};
function availableMedia(profile:SavedProfile):ProfileMedia[]{
 // Keep older references in storage untouched; display at most the adopted five.
 return (profile.media??[]).slice(0,PROFILE_ALBUM_LIMIT);
}
/** A Telegram media album is a group of 2-5 original file references. */
export async function sendProfileAlbum(
 telegram:Context["telegram"],userId:number,profile:SavedProfile
):Promise<number>{
 const items=availableMedia(profile);
 if(!Number.isSafeInteger(userId)||userId<=0)throw Error("PROFILE_ALBUM_ACTOR_INVALID");
 if(!items.length)return 0;
 if(items.length===1){
  const entry=items[0]!;
  if(entry.type==="photo")await telegram.sendPhoto(userId,entry.fileId);
  else await telegram.sendVideo(userId,entry.fileId);
 }else{
  const album=items.map(entry=>entry.type==="photo"?
   {type:"photo" as const,media:entry.fileId}:
   {type:"video" as const,media:entry.fileId});
  await telegram.sendMediaGroup(userId,album);
 }
 return items.length;
}
export function renderPublishedTagDetail(profile:SavedProfile):string{
 const render=(purpose:"like"|"love")=>{
  const tags=purpose==="like"?profile.likeTags??[]:profile.loveTags??[];
  return [
   purpose==="like"?"💖 #Like｜自分について":"💘 #Love｜相手に求めること",
   ...LIKE_CATEGORIES.map(c=>{
    const values=tags.filter(t=>t.category===c.name).map(t=>"#"+t.tag);
    return c.name+"："+values.join(" ");
   }),
  ].join("\n");
 };
 return render("like")+"\n\n"+render("love");
}
function mediaKeyboard(token:string,profile:SavedProfile,page:number){
 const media=availableMedia(profile);
 const total=Math.max(1,Math.ceil(media.length/12));
 if(!Number.isInteger(page)||page<0||page>=total)throw Error("PROFILE_MEDIA_VIEW_PAGE_INVALID");
 const buttons=media.slice(page*12,page*12+12).map(item=>[
  Markup.button.callback("No."+item.itemId+" "+(item.type==="photo"?"🖼️画像":"🎬動画"),
   "pfv:media:"+token+":item:"+item.itemId),
 ]);
 const nav=[];
 if(page>0)nav.push(Markup.button.callback("◀ 前へ","pfv:media:"+token+":page:"+(page-1)));
 if(page+1<total)nav.push(Markup.button.callback("次へ ▶","pfv:media:"+token+":page:"+(page+1)));
 if(nav.length)buttons.push(nav);
 return Markup.inlineKeyboard(buttons);
}
function mediaSummary(profile:SavedProfile,page:number){
 return "🖼️ 画像・動画の一覧\n公開プロフィールの媒体は選択したものだけ表示します。"+
  "\n表示したい番号を押してください。\n"+(page+1)+"/"+
  Math.max(1,Math.ceil(availableMedia(profile).length/12))+"ページ";
}
export async function startProfileViewer(ctx:Context,payload:string):Promise<void>{
 if(ctx.chat?.type!=="private"||!ctx.from)return;
 const parsed=parseProfileViewerPayload(payload);
 if(!parsed){await ctx.reply("このプロフィールリンクは無効です。");return;}
 const profile=await resolvePublishedProfileView(parsed.token);
 if(!profile){await ctx.reply("このプロフィールは現在公開されていません。");return;}
 if(parsed.purpose==="profile"){
  const buttons:ReadonlyArray<{text:string;url:string}>=[
   {text:"🖼️画像/動画",url:profileViewerUrl("media",parsed.token)},
   {text:"#Love & Like",url:profileViewerUrl("tags",parsed.token)},
  ];
  await ctx.reply(renderPublicProfile(profile),{
   parse_mode:"HTML",...Markup.inlineKeyboard([
    buttons.map(x=>Markup.button.url(x.text,x.url)),
    ...(profile.pr&&profile.pr.length>180?[[Markup.button.callback("自己PR全文",
      "pfv:pr:"+parsed.token)]]:[]),
   ]),
  });
 }else if(parsed.purpose==="tags"){
  await ctx.reply(renderPublishedTagDetail(profile));
 }else{
  if(!availableMedia(profile).length){
   await ctx.reply("このプロフィールに公開対象の画像・動画はありません。");
   return;
  }
  try{
   await sendProfileAlbum(ctx.telegram,ctx.from.id,profile);
  }catch{
   await ctx.reply("アルバムの表示に失敗しました。あとで再度お試しください。");
  }
 }
}
/** Media display never edits or forwards the owner's original upload. */
export function registerProfileViewerHandlers(bot:Telegraf):void{
 bot.action(/^pfv:pr:([A-Za-z0-9_-]{32})$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const profile=await resolvePublishedProfileView(ctx.match[1]!);
  if(!profile){await ctx.answerCbQuery("このプロフィールは非公開です");return;}
  if(!profile.pr){await ctx.answerCbQuery("自己PRはありません");return;}
  await ctx.answerCbQuery();
  await ctx.reply("📝 自己PR全文\\n"+profile.pr.slice(0,10000));
 });
 bot.action(/^pfv:media:([A-Za-z0-9_-]{32}):page:(\d{1,3})$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const token=ctx.match[1]!,page=Number(ctx.match[2]);
  const profile=await resolvePublishedProfileView(token);
  if(!profile||page>=Math.ceil(availableMedia(profile).length/12)){
   await ctx.answerCbQuery("このプロフィールを表示できません");return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageText(mediaSummary(profile,page),mediaKeyboard(token,profile,page));
 });
 bot.action(/^pfv:media:([A-Za-z0-9_-]{32}):item:(\d{1,12})$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const profile=await resolvePublishedProfileView(ctx.match[1]!);
  const id=Number(ctx.match[2]);
  const item=profile?availableMedia(profile).find(x=>x.itemId===id):undefined;
  if(!item){await ctx.answerCbQuery("この画像・動画は表示できません");return;}
  await ctx.answerCbQuery();
  try{
   if(item.type==="photo")await ctx.replyWithPhoto(item.fileId);
   else await ctx.replyWithVideo(item.fileId);
  }catch{
   await ctx.reply("このメディアは現在表示できません。");
  }
 });
}
