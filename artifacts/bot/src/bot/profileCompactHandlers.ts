/** Common recruitment-style profile editor.
 * It uses the canonical Room selector/tag panels and the existing profile
 * repository/media store. Sources are copied only after an explicit tap.
 */
import {Markup,type Telegraf,type Context,type Telegram} from "telegraf";
import * as profiles from "../services/profileRepository.js";
import {getDraft as getPostDraft} from "../services/publicPostRepository.js";
import {pool} from "../db/index.js";
import {getProfile} from "../services/profileRepository.js";
import {recruitmentCompactSelectorRows,recruitmentSelectionRows} from "../services/recruitmentButtonLayout.js";
import {styledInlineButton as button} from "../services/inlineButtonStyle.js";
import {roomRecruitmentCategoryRows,roomRecruitmentTagRows,roomRecruitmentTagHeading} from "../services/roomRecruitmentTagPanels.js";
import {PROFILE_POSITIONS,isProfilePosition,parseProfileBasic,renderProfileBasicPreview,escapeProfileHtml} from "../services/profileCore.js";
import {parseRecruitmentMessage} from "../services/recruitmentCompose.js";
import {PURPOSE_TAGS,PLACE_TAGS,normalizePlaceCodes} from "../services/announcementTags.js";
import {LIKE_CATEGORIES,likePageBounds,toggleLike,validLikeTags,type LikeTag} from "../services/profileLike.js";
import {PROFILE_ALBUM_LIMIT,appendProfileMedia,replaceProfileMedia,deleteProfileMedia,numberProfileMedia,type ProfileMediaItem} from "../services/profileMedia.js";
import {sendProfileAlbum} from "./profileViewerHandlers.js";
import {startCompactRecruitmentEditor} from "./recruitmentHandlers.js";
import {startRoomEditor} from "./postingHandlers.js";
import {resumeApplicationEditor} from "./applicationHandlers.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {showWizardScreen,removeUserWizardInput} from "../services/dmWizardScreen.js";
import {editMessageToDmPostingMenu} from "../services/dmPostingMenuRestore.js";
import type {ProfileDraft} from "../services/profileRepository.js";

type Origin="profile"|"recruit"|"room"|"application";
type Panel="position"|"like"|"love"|"purpose"|"place";
const origins=new Set<Origin>(["profile","recruit","room","application"]);
const validPanel=(v:unknown):v is Panel=>
 v==="position"||v==="like"||v==="love"||v==="purpose"||v==="place";
const tags=(d:ProfileDraft["data"],purpose:"like"|"love"):LikeTag[] =>
 validLikeTags(purpose==="like"?(d.likeTags??[]):(d.loveTags??[]));
const active=(d:ProfileDraft|null,revision:number):d is ProfileDraft=>
 !!d&&d.revision===revision&&
 ["compact","compact_panel","compact_media"].includes(d.step);

export function compactProfileRows(d:ProfileDraft){
 const r=d.revision,x=d.data;
 const selector=recruitmentCompactSelectorRows("manual",!!x.position,{
  like:(x.likeTags??[]).length>0,love:(x.loveTags??[]).length>0,
  purpose:(x.purposeCodes??[]).length>0,place:(x.placeCodes??[]).length>0
 },{
  position:"pc:"+r+":open:position",like:"pc:"+r+":open:like",
  love:"pc:"+r+":open:love",purpose:"pc:"+r+":open:purpose",
  place:"pc:"+r+":open:place",
 });
 return Markup.inlineKeyboard([
  ...selector,
  [button("🖼️🎬 アルバム "+(x.media?.length??0)+"/"+PROFILE_ALBUM_LIMIT,
    "pc:"+r+":media","primary"),
   button("容姿/エリア","pc:"+r+":appearance","primary")],
  [button("✅ プロフィール保存","pc:"+r+":save","success"),
   button("キャンセル","pc:"+r+":cancel","danger")]
 ]);
}
function intro(d:ProfileDraft):string{
 const x=d.data;
 const guidance=[
  "🪪 プロフィール｜相手募集と共通入力",
  "入力した情報は非公開保存され、グループには自動投稿されません。",
  "",
  "1行目：タイトル",
  "2行目：ニックネーム",
  "3行目：身長 体重 年齢",
  "4行目以降：自己PR（任意・改行自由）",
  "",
  "例：",
  "自己紹介",
  "ゼロ",
  "175 80 40",
  "趣味や好きなことを書きます。",
  "",
  "ポジション・#Like・#Love・目的・場所はボタンで選択。",
  "🖼️🎬 アルバムから写真・動画を合計5件まで登録できます。",
  "投稿や応募中に作成した場合も、元の募集・応募はそのまま残ります。",
 ];
 if(x.nickname&&x.heightCm&&x.weightKg&&x.age){
  const selected=[
   "タイトル："+(x.title||"未設定"),
   "ニックネーム："+x.nickname,
   x.heightCm+"cm | "+x.weightKg+"kg | "+x.age+"歳 | "+(x.position??"未選択"),
   "自己PR："+(x.pr?.slice(0,250)||"未設定"),
   "#Like："+(x.likeTags??[]).map(t=>"#"+t.tag).join(" "),
   "#Love："+(x.loveTags??[]).map(t=>"#"+t.tag).join(" "),
   "目的："+(x.purposeCodes??[]).join("、"),
   "場所："+(x.placeCodes??[]).join("、"),
  ];
  return guidance.join("\n")+"\n\n【入力済みプレビュー】\n"+selected.join("\n");
 }
 return guidance.join("\n");
}
function panelKeyboard(d:ProfileDraft){
 const r=d.revision,x=d.data,p=x.compactPanel;
 if(!validPanel(p))throw Error("PROFILE_COMPACT_PANEL_MISSING");
 const cb={
  openCategory:(i:number)=>"pc:"+r+":cat:"+i,
  selectItem:(_c:number,i:number)=>"pc:"+r+":pick:"+i,
  changePage:(_c:number,i:number)=>"pc:"+r+":page:"+i,
  save:"pc:"+r+":savepanel",back:"pc:"+r+":back",cancel:"pc:"+r+":cancel"
 };
 if(p==="like"||p==="love"){
  const cat=x.compactCategory;
  if(typeof cat==="number")return Markup.inlineKeyboard(
   roomRecruitmentTagRows(cat,x.compactPage??0,tags(x,p),cb,p));
  return Markup.inlineKeyboard(roomRecruitmentCategoryRows(cb,p));
 }
 const values:readonly string[]=p==="position"?PROFILE_POSITIONS:p==="purpose"?PURPOSE_TAGS:PLACE_TAGS;
 const selected:readonly string[]=p==="position"?(x.position?[x.position]:[]):
  p==="purpose"?(x.purposeCodes??[]):(x.placeCodes??[]);
 const rows=recruitmentSelectionRows(values,true).map(group=>
  group.map(value=>button((selected.includes(value)?"✅ ":"▫️ ")+value,
   "pc:"+r+":pick:"+values.indexOf(value),"primary")));
 return Markup.inlineKeyboard([...rows,[
  button("↩ 戻る","pc:"+r+":back"),
  button("✅ 保存","pc:"+r+":back","success"),
  button("キャンセル","pc:"+r+":cancel","danger")
 ]]);
}
function panelText(d:ProfileDraft):string{
 const p=d.data.compactPanel;
 if(!validPanel(p))throw Error("PROFILE_COMPACT_PANEL_MISSING");
 if(p==="like"||p==="love")
  return roomRecruitmentTagHeading(p,
   typeof d.data.compactCategory==="number"?d.data.compactCategory:undefined)+
   "\n選択中："+tags(d.data,p).length+"件";
 return p==="position"?"ポジションを選んでください。":
  p==="purpose"?"🎯 目的を選んでください（複数選択可）。":
  "📍 場所あり/なしは択一、足ありは独立して選択できます。";
}
function mediaText(d:ProfileDraft):string{
 const media=numberProfileMedia(d.data.media);
 return "🖼️🎬 プロフィールのアルバム\n画像・動画は合計"+PROFILE_ALBUM_LIMIT+"件まで。"+
  "\nTelegramの添付から写真・動画を送ってください。"+
  "\n既存の画像/動画を変える場合「差替 番号」、消す場合「削除 番号」と入力。"+
  "\n登録済み "+media.length+"/"+PROFILE_ALBUM_LIMIT+"件"+
  (media.length?"\n"+media.map(v=>"No."+v.itemId+" "+(v.type==="photo"?"🖼️画像":"🎬動画")).join("\n"):"")+
  (d.data.replaceMediaId?"\n差替対象：No."+d.data.replaceMediaId:"")+
  "\n元画像をグループへ自動公開しません。";
}
function mediaKeyboard(d:ProfileDraft){
 const r=d.revision;
 return Markup.inlineKeyboard([
  [button("🖼️アルバムを見る","pc:"+r+":album","primary")],
  [button("↩ 戻る","pc:"+r+":back"),
   button("✅ 保存","pc:"+r+":save","success"),
   button("キャンセル","pc:"+r+":cancel","danger")],
 ]);
}
async function render(telegram:Telegram,id:number,d:ProfileDraft,notice=""){
 const markup=d.step==="compact_panel"?panelKeyboard(d):
  d.step==="compact_media"?mediaKeyboard(d):compactProfileRows(d);
 const body=(notice?notice+"\n\n":"")+
  (d.step==="compact_panel"?panelText(d):
   d.step==="compact_media"?mediaText(d):intro(d));
 const old=d.data.screenMessageId;
 const result=await showWizardScreen(telegram,id,old,body,markup);
 if(result.messageId!==old)await profiles.bindScreenMessage(id,d.revision,result.messageId);
}
function seedExisting(profile:Awaited<ReturnType<typeof getProfile>>):ProfileDraft["data"]{
 if(!profile)return {};
 return {
  title:profile.title||"プロフィール",nickname:profile.nickname,
  heightCm:profile.heightCm,weightKg:profile.weightKg,age:profile.age,
  position:profile.position,pr:profile.pr,prRef:profile.prRef,
  hair:profile.hair,body:profile.body,region:profile.region,area:profile.area,
  media:profile.media,mediaNextId:profile.mediaNextId,
  likeTags:profile.likeTags,loveTags:profile.loveTags,
  purposeCodes:profile.purposeCodes??[],placeCodes:profile.placeCodes??[]
 };
}
export async function startCompactProfileEditor(
 ctx:Context,origin:Origin="profile",source:ProfileDraft["data"]={}
):Promise<void>{
 if(ctx.chat?.type!=="private"||!ctx.from)return;
 if(!ctx.from.username){
  await ctx.reply("プロフィール登録にはTelegramのusernameが必要です。");return;
 }
 if(!origins.has(origin))throw Error("PROFILE_COMPACT_ORIGIN_INVALID");
 const existingDraft=await profiles.getDraft(ctx.from.id);
 if(existingDraft){
  // Always enter the same compact editor, including users with older
  // in-progress profile drafts. Preserve their input and linked media.
  const next=await profiles.putDraft(ctx.from.id,"compact",{
   ...existingDraft.data,compactOrigin:origin
  },existingDraft.revision);
  await render(ctx.telegram,ctx.from.id,next);return;
 }
 const existing=await profiles.getProfile(ctx.from.id);
 // Never allow a recruitment draft to silently overwrite an existing original.
 const base=existing?seedExisting(existing):source;
 const data={...base,compactOrigin:origin,purposeCodes:base.purposeCodes??[],
  placeCodes:base.placeCodes??[],likeTags:base.likeTags??[],loveTags:base.loveTags??[],
  media:base.media??[],mediaNextId:base.mediaNextId??1};
 const draft=await profiles.putDraft(ctx.from.id,"compact",data);
 await render(ctx.telegram,ctx.from.id,draft,
  existing&&origin!=="profile"?"登録済みプロフィールを開きました。今回の募集・応募内容で自動上書きしていません。":"");
}
async function resumeOrigin(ctx:Context,origin:Origin):Promise<void>{
 if(!ctx.from)return;
 if(origin==="recruit")await startCompactRecruitmentEditor(ctx.telegram,ctx.from.id);
 else if(origin==="room")await startRoomEditor(ctx.telegram,ctx.from.id);
 else if(origin==="application")await resumeApplicationEditor(ctx.telegram,ctx.from.id);
 else await editMessageToDmPostingMenu(ctx,ctx.from.id);
}
function assertSourceScreen(d:any,ctx:Context):void{
 const bound=Number(d?.data?.screenMessageId);
 const clicked=ctx.callbackQuery && "message" in ctx.callbackQuery?
  ctx.callbackQuery.message?.message_id:undefined;
 if(Number.isSafeInteger(bound)&&bound>0&&clicked!==bound)
  throw Error("PROFILE_SOURCE_SCREEN_STALE");
}
export function sourceData(d:Record<string,unknown>):ProfileDraft["data"]{
 const nickname=typeof d.nickname==="string"?d.nickname:undefined;
 const title=typeof d.title==="string"?d.title:undefined;
 const h=Number(d.heightCm),w=Number(d.weightKg),a=Number(d.age);
 const identity=nickname&&[h,w,a].every(x=>Number.isSafeInteger(x)&&x>0)?
  {nickname,heightCm:h,weightKg:w,age:a}:{};
 return {
  ...identity,title,position:isProfilePosition(String(d.position??""))?String(d.position) as typeof PROFILE_POSITIONS[number]:undefined,
  pr:typeof d.body==="string"?d.body:typeof d.description==="string"?d.description:undefined,
  purposeCodes:Array.isArray(d.purposeCodes)?d.purposeCodes as string[]:[],
  placeCodes:Array.isArray(d.placeCodes)?d.placeCodes as string[]:[],
  likeTags:validLikeTags(Array.isArray(d.likeTags)?d.likeTags as LikeTag[]:[]),
  loveTags:validLikeTags(Array.isArray(d.loveTags)?d.loveTags as LikeTag[]:[])
 };
}
export function registerCompactProfileHandlers(bot:Telegraf):void{
 bot.action(/^pc:from:(recruit|room|application)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const source=ctx.match[1] as Origin;
  try{
   let seed:ProfileDraft["data"]={};
   if(source==="application"){
    const row=await pool.query(
     "SELECT draft,screen_message_id FROM announcement_application_sessions WHERE applicant_user_id=$1 AND draft_step IN ('preview','awaiting_text') AND expires_at>NOW()",
     [ctx.from.id]);
    if(row.rows.length!==1||Number(row.rows[0].screen_message_id)!==ctx.callbackQuery.message?.message_id)
     throw Error("PROFILE_SOURCE_SCREEN_STALE");
    seed=sourceData(row.rows[0].draft as Record<string,unknown>);
   }else{
    const d=await getPostDraft(ctx.from.id,source==="room"?"room":"announcement");
    if(!d||(source==="recruit"&&d.data.recruitmentFlow!=="compact"))
     throw Error("PROFILE_SOURCE_DRAFT_MISSING");
    assertSourceScreen(d,ctx);
    seed=sourceData(d.data);
   }
   await ctx.answerCbQuery();
   await startCompactProfileEditor(ctx,source,seed);
  }catch{
   await ctx.answerCbQuery("元の入力画面を確認できません。開き直してください。",{show_alert:true}).catch(()=>undefined);
  }
 });
 bot.action(/^pc:(\d+):open:(position|like|love|purpose|place)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const d=await profiles.getDraft(ctx.from.id),r=Number(ctx.match[1]);
  if(!active(d,r)||d.step!=="compact"){await ctx.answerCbQuery("古い操作です");return;}
  const next=await profiles.putDraft(ctx.from.id,"compact_panel",{
   ...d.data,compactPanel:ctx.match[2] as Panel,compactCategory:null,compactPage:0},r);
  await ctx.answerCbQuery();await render(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^pc:(\d+):cat:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const r=Number(ctx.match[1]),cat=Number(ctx.match[2]);
  const d=await profiles.getDraft(ctx.from.id);
  if(!active(d,r)||d.step!=="compact_panel"||
    !["like","love"].includes(String(d.data.compactPanel))||
    typeof d.data.compactCategory==="number"||!LIKE_CATEGORIES[cat]){
   await ctx.answerCbQuery("古い分類です");return;
  }
  const next=await profiles.putDraft(ctx.from.id,"compact_panel",{
   ...d.data,compactCategory:cat,compactPage:0},r);
  await ctx.answerCbQuery();await render(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^pc:(\d+):page:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const r=Number(ctx.match[1]),page=Number(ctx.match[2]);
  const d=await profiles.getDraft(ctx.from.id);
  if(!active(d,r)||d.step!=="compact_panel"||
    !["like","love"].includes(String(d.data.compactPanel))||
    typeof d.data.compactCategory!=="number"){
   await ctx.answerCbQuery("古いページです");return;
  }
  try{likePageBounds(d.data.compactCategory,page);}catch{await ctx.answerCbQuery("無効なページです");return;}
  const next=await profiles.putDraft(ctx.from.id,"compact_panel",{...d.data,compactPage:page},r);
  await ctx.answerCbQuery();await render(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^pc:(\d+):savepanel$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const rev=Number(ctx.match[1]),d=await profiles.getDraft(ctx.from.id);
  if(!active(d,rev)||d.step!=="compact_panel"||
     !["like","love"].includes(String(d.data.compactPanel))){
   await ctx.answerCbQuery("古い操作です");return;
  }
  const next=await profiles.putDraft(ctx.from.id,"compact",{
   ...d.data,compactPanel:undefined,compactCategory:null,compactPage:0},rev);
  await ctx.answerCbQuery();await render(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^pc:(\d+):pick:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const r=Number(ctx.match[1]),index=Number(ctx.match[2]),d=await profiles.getDraft(ctx.from.id);
  if(!active(d,r)||d.step!=="compact_panel"||!validPanel(d.data.compactPanel)){
   await ctx.answerCbQuery("古い選択です");return;
  }
  const p=d.data.compactPanel,x=d.data;
  let updated:ProfileDraft["data"]={...x};
  if(p==="position"){
   if(!PROFILE_POSITIONS[index]){await ctx.answerCbQuery("無効です");return;}
   updated.position=PROFILE_POSITIONS[index];
  }else if(p==="purpose"){
   const value=PURPOSE_TAGS[index];
   if(!value){await ctx.answerCbQuery("無効です");return;}
   const old=x.purposeCodes??[];
   updated.purposeCodes=old.includes(value)?old.filter(t=>t!==value):[...old,value];
  }else if(p==="place"){
   const value=PLACE_TAGS[index];
   if(!value){await ctx.answerCbQuery("無効です");return;}
   const old=x.placeCodes??[];
   const location=value==="足あり"?
    old.includes("場所あり")?"場所あり":old.includes("場所なし")?"場所なし":null:
    old.includes(value)?null:value;
   const transport=value==="足あり"?!old.includes("足あり"):old.includes("足あり");
   updated.placeCodes=normalizePlaceCodes(location,transport);
  }else{
   const category=x.compactCategory,page=x.compactPage??0;
   if(typeof category!=="number"){await ctx.answerCbQuery("分類を選択してください");return;}
   const bounds=likePageBounds(category,page);
   if(index<bounds.start||index>=bounds.end){await ctx.answerCbQuery("古い選択です");return;}
   const field=p==="like"?"likeTags":"loveTags";
   updated={...x,[field]:toggleLike(tags(x,p),category,index)};
  }
  const next=await profiles.putDraft(ctx.from.id,"compact_panel",updated,r);
  await ctx.answerCbQuery();await render(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^pc:(\d+):(back|media|appearance|save|cancel|album)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const r=Number(ctx.match[1]),action=ctx.match[2];
  const d=await profiles.getDraft(ctx.from.id);
  if(!active(d,r)){await ctx.answerCbQuery("古い画面です");return;}
  if(action==="album"){
   await ctx.answerCbQuery();
   const album=d.data.media??[];
   if(!album.length){await ctx.telegram.sendMessage(ctx.from.id,"アルバムはまだ空です。");return;}
   const profile={...d.data,media:album} as Awaited<ReturnType<typeof getProfile>>;
   try{await sendProfileAlbum(ctx.telegram,ctx.from.id,profile!);}
   catch{await ctx.telegram.sendMessage(ctx.from.id,"アルバムを表示できませんでした。");}
   return;
  }
  if(action==="cancel"){
   const origin=origins.has(d.data.compactOrigin as Origin)?d.data.compactOrigin as Origin:"profile";
   await profiles.discardDraft(ctx.from.id,r);
   await ctx.answerCbQuery();await resumeOrigin(ctx,origin);return;
  }
  if(action==="save"){
   if(!ctx.from.username){await ctx.answerCbQuery("usernameを登録してください。",{show_alert:true});return;}
   if(!d.data.title?.trim()||!d.data.nickname||!d.data.position||!d.data.heightCm||
      !d.data.weightKg||!d.data.age||!isProfilePosition(d.data.position)){
    await ctx.answerCbQuery("タイトル・基本情報・ポジションを入力してください。",{show_alert:true});
    return;
   }
   const profile=await profiles.savePrivateDraft(ctx.from.id,r,ctx.from.username??null);
   await ctx.answerCbQuery("プロフィールを非公開保存しました");
   const origin=origins.has(d.data.compactOrigin as Origin)?d.data.compactOrigin as Origin:"profile";
   await ctx.editMessageText((profile.status==="published"?"✅ 変更を保存しました。公開済み投稿は自動更新されません。\n":"✅ プロフィールを非公開保存しました。\n")+
    renderProfileBasicPreview(profile,ctx.from.username??""),{
    parse_mode:"HTML",
    ...Markup.inlineKeyboard([[button("↩ 元の操作へ戻る","pc:return:"+origin)]])
   });
   return;
  }
  if(action==="appearance"){
   const next=await profiles.putDraft(ctx.from.id,"appearance",d.data,r);
   await ctx.answerCbQuery();
   // Existing appearance handler owns the adopted hair/body/area screens.
   await ctx.editMessageText("容姿・エリアは既存のプロフィール項目で設定できます。",Markup.inlineKeyboard([[
    button("髪型","pf:ap:"+next.revision+":open:h"),
    button("体型","pf:ap:"+next.revision+":open:b"),
    button("エリア","pf:ap:"+next.revision+":area"),
    button("↩ 戻る","pf:ap:"+next.revision+":back"),
   ],[button("保存","pf:section:"+next.revision+":save","success")]]));
   return;
  }
  if(action==="media"){
   const next=await profiles.putDraft(ctx.from.id,"compact_media",d.data,r);
   await ctx.answerCbQuery();await render(ctx.telegram,ctx.from.id,next);return;
  }
  if(d.step==="compact_panel"&&
     ["like","love"].includes(String(d.data.compactPanel))&&
     typeof d.data.compactCategory==="number"){
   const next=await profiles.putDraft(ctx.from.id,"compact_panel",{
    ...d.data,compactCategory:null,compactPage:0},r);
   await ctx.answerCbQuery();await render(ctx.telegram,ctx.from.id,next);return;
  }
  const next=await profiles.putDraft(ctx.from.id,"compact",{
   ...d.data,compactPanel:undefined,compactCategory:null,replaceMediaId:undefined},r);
  await ctx.answerCbQuery();await render(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^pc:return:(profile|recruit|room|application)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  await ctx.answerCbQuery();await resumeOrigin(ctx,ctx.match[1] as Origin);
 });
 bot.on("text",async(ctx,next)=>{
  if(ctx.chat.type!=="private"||ctx.message.text.startsWith("/")||
    await currentDmTextOwner(ctx.from.id)!=="profile")return next();
  const d=await profiles.getDraft(ctx.from.id);
  if(!d||!["compact","compact_media"].includes(d.step))return next();
  const deleted=await removeUserWizardInput(ctx.telegram,ctx.chat.id,ctx.message.message_id);
  const notice=deleted?"":"⚠️ 送信メッセージを自動削除できませんでした。手動で削除してください。";
  try{
   if(d.step==="compact"){
    const text=ctx.message.text;
    let parsed:Partial<ProfileDraft["data"]>;
    if(text.trim().split(/\r?\n/).length===2){
     parsed=parseProfileBasic(text);
    }else{
     const input=parseRecruitmentMessage(text,false);
     parsed={title:input.title,nickname:input.nickname,heightCm:input.heightCm,
      weightKg:input.weightKg,age:input.age,pr:input.body};
    }
    const next=await profiles.putDraft(ctx.from.id,"compact",{...d.data,...parsed},d.revision);
    await render(ctx.telegram,ctx.from.id,next,notice);
   }else{
    const text=ctx.message.text.trim();
    const match=/^(削除|差替)\s*(\d+)$/.exec(text);
    const old=numberProfileMedia(d.data.media);
    let data={...d.data};
    if(match){
     const id=Number(match[2]);
     if(!old.some(v=>v.itemId===id))throw Error("指定番号はアルバムにありません。");
     if(match[1]==="削除")data={...data,media:deleteProfileMedia(old,id),replaceMediaId:undefined};
     else data={...data,replaceMediaId:id};
    }else if(text==="差替取消")data={...data,replaceMediaId:undefined};
    else throw Error("画像・動画は添付で送信。差替・削除は番号を指定してください。");
    const next=await profiles.putDraft(ctx.from.id,"compact_media",data,d.revision);
    await render(ctx.telegram,ctx.from.id,next,notice);
   }
  }catch(e){
   await render(ctx.telegram,ctx.from.id,d,
    "⚠️ "+(e instanceof Error?e.message:"入力を確認してください。")+(notice?"\n"+notice:""));
  }
 });
 const mediaInput=async(ctx:Context,next:()=>Promise<unknown>,kind:"photo"|"video")=>{
  if(ctx.chat?.type!=="private"||!ctx.from||
    await currentDmTextOwner(ctx.from.id)!=="profile")return next();
  const d=await profiles.getDraft(ctx.from.id);
  if(!d||d.step!=="compact_media")return next();
  const message=ctx.message;
  if(!message)return next();
  const photo=kind==="photo"&&"photo" in message?message.photo.at(-1):undefined;
  const video=kind==="video"&&"video" in message?message.video:undefined;
  const fileId=photo?.file_id??video?.file_id;
  if(!fileId)return next();
  const entry:ProfileMediaItem={
   type:kind,fileId,sourceMessageId:message.message_id,
   ...("media_group_id" in message&&typeof message.media_group_id==="string"?
    {mediaGroupId:message.media_group_id}:{})
  };
  const deleted=await removeUserWizardInput(ctx.telegram,ctx.chat.id,message.message_id);
  const notice=deleted?"":"⚠️ 媒体メッセージを削除できません。手動で削除してください。";
  try{
   const old=numberProfileMedia(d.data.media);
   const replace=d.data.replaceMediaId;
   const id=Math.max(d.data.mediaNextId??1,...old.map(v=>(v.itemId??0)+1),1);
   const updated=replace!==undefined?
    replaceProfileMedia(old,replace,entry):
    numberProfileMedia(appendProfileMedia(old,{...entry,itemId:id}));
   const next=await profiles.putDraft(ctx.from.id,"compact_media",{
    ...d.data,media:updated,mediaNextId:replace!==undefined?id:id+1,
    replaceMediaId:undefined},d.revision);
   await render(ctx.telegram,ctx.from.id,next,notice);
  }catch(e){
   await render(ctx.telegram,ctx.from.id,d,
    "⚠️ "+(e instanceof Error&&e.message==="PROFILE_ALBUM_FULL"?
     "アルバムは5件までです。差し替えるか、既存の項目を削除してください。":
     "アルバムへの登録に失敗しました。")+(notice?"\n"+notice:""));
  }
  return;
 };
 bot.on("photo",async(ctx,next)=>mediaInput(ctx,next,"photo"));
 bot.on("video",async(ctx,next)=>mediaInput(ctx,next,"video"));
}
