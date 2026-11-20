import {Markup,type Context,type Telegraf} from "telegraf";
import {renderPublicProfile,escapeProfileHtml} from "../services/profileCore.js";
import {LIKE_CATEGORIES} from "../services/profileLike.js";
import {parseProfileViewerPayload,profileViewerUrl,resolvePublishedProfileView,resolvePublishedProfilePanel,profilePanelRows,
 type ViewerPurpose} from "../services/profilePublicView.js";
import type {SavedProfile} from "../services/profileRepository.js";

type ProfileMedia={itemId?:number;fileId:string;type:"photo"|"video"};
function availableMedia(profile:SavedProfile):ProfileMedia[]{
 return profile.media??[];
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
  await ctx.reply(mediaSummary(profile,0),mediaKeyboard(parsed.token,profile,0));
 }
}
/** Media display never edits or forwards the owner's original upload. */
export function registerProfileViewerHandlers(bot:Telegraf):void{
 registerPublicProfilePanelHandlers(bot);
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

/** Public group callbacks: text sections edit the existing card in place.
 * Telegram media cannot be converted back into a text message with editMessageText;
 * reveal media as a reply to the original post, never in a Bot DM. */
export function registerPublicProfilePanelHandlers(bot:Telegraf):void{
 bot.action(/^pfv:contact:([A-Za-z0-9_-]{32})$/,async ctx=>{
  await ctx.answerCbQuery("投稿者にTelegram usernameが設定されていません。",{show_alert:true});
 });
 bot.action(/^pfv:show:([A-Za-z0-9_-]{32}):(profile|photo|video|like|love)$/,async ctx=>{
  const msg=ctx.callbackQuery.message;
  if(!msg||!ctx.chat||ctx.chat.type!=="supergroup"){
   await ctx.answerCbQuery("公開プロフィールから操作してください");return;
  }
  const token=ctx.match[1]!,mode=ctx.match[2]!;
  const profile=await resolvePublishedProfilePanel(token,ctx.chat.id,msg.message_id);
  if(!profile){await ctx.answerCbQuery("公開状態を確認できません");return;}
  if(mode==="photo"||mode==="video"){
   const selected=availableMedia(profile).filter(x=>x.type===(mode==="photo"?"photo":"video"));
   if(!selected.length){await ctx.answerCbQuery("登録されたメディアはありません");return;}
   await ctx.answerCbQuery();
   // The media is attached to the public group post and never sent to a Bot DM.
   for(const item of selected.slice(0,5)){
    if(item.type==="photo")await ctx.telegram.sendPhoto(ctx.chat.id,item.fileId,{reply_parameters:{message_id:msg.message_id}});
    else await ctx.telegram.sendVideo(ctx.chat.id,item.fileId,{reply_parameters:{message_id:msg.message_id}});
   }
   return;
  }
  const text=mode==="profile"?renderPublicProfile(profile):mode==="like"?
   "💖 #Like｜自分について\\n"+LIKE_CATEGORIES.map(c=>c.name+"："+(profile.likeTags??[]).filter(t=>t.category===c.name).map(t=>"#"+t.tag).join(" ")).join("\\n"):
   "💘 #Love｜相手に求めること\\n"+LIKE_CATEGORIES.map(c=>c.name+"："+(profile.loveTags??[]).filter(t=>t.category===c.name).map(t=>"#"+t.tag).join(" ")).join("\\n");
  await ctx.answerCbQuery();
  // Group messages are shared: an edit is visible to every member.
  await ctx.editMessageText(text,{parse_mode:"HTML",...Markup.inlineKeyboard(profilePanelRows(token,profile.username).map(row=>row.map(b=>b.url?Markup.button.url(b.text,b.url):Markup.button.callback(b.text,b.callback_data!))))});
 });
}
