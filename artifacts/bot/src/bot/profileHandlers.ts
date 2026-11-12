import { Telegraf, Markup, type Context } from "telegraf";
import type { ProfileDraft, SavedProfile } from "../services/profileRepository.js";
import * as profileRepo from "../services/profileRepository.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {profileOverviewButtons} from "../services/profileOverviewLayout.js";
import {nextSelection,selectionRows} from "../services/inlineSelection.js";
import {LIKE_CATEGORIES,likeCategoryRows,likeItemRows,likePageIndex,toggleLike,validLikeTags,tagPurposeDescription,type ProfileTagPurpose} from "../services/profileLike.js";
import {HAIR_CHOICES,BODY_CHOICES,HAIR_ROWS,BODY_ROWS} from "../services/profileAppearance.js";
import {PROFILE_AREA_BLOCKS,areaChildren,areaButtonRows,toggleProfileArea,isAreaBlock,type ProfileAreaBlock} from "../services/profileArea.js";
import {editMessageToDmPostingMenu} from "../services/dmPostingMenuRestore.js";
import {appendProfileMedia,mediaStatus,numberProfileMedia,replaceProfileMedia,deleteProfileMedia,type ProfileMediaItem} from "../services/profileMedia.js";
import {
  PROFILE_POSITIONS, type ProfilePosition, parseProfileBasic, renderProfileBasicPreview,
} from "../services/profileCore.js";

type ProfileRepo = {
  getDraft: typeof profileRepo.getDraft;
  putDraft: typeof profileRepo.putDraft;
  getProfile: typeof profileRepo.getProfile;
  savePrivateDraft: typeof profileRepo.savePrivateDraft;
  discardDraft: typeof profileRepo.discardDraft;
  bindScreenMessage: typeof profileRepo.bindScreenMessage;
  getLastScreenMessageId: typeof profileRepo.getLastScreenMessageId;
};

const selectPosition = (revision: number, selected?: ProfilePosition) => Markup.inlineKeyboard([
  ...selectionRows(
    [[...PROFILE_POSITIONS.slice(0,3)],[...PROFILE_POSITIONS.slice(3)]],
    selected?[selected]:[],
    value=>`pf:pos:${revision}:${PROFILE_POSITIONS.indexOf(value)}`,
  ).map(row=>row.map(button=>Markup.button.callback(button.text,button.callback_data))),
  [Markup.button.callback("キャンセルして戻る", `pf:cancel:${revision}`)],
]);

const requestBasic = [
  "🪪 プロフィールを作成しましょう！",
  "",
  "登録したプロフィールは、相手募集やROOMなどでも利用できます。",
  "登録するだけではグループに公開されません。",
  "",
  "📝 登録方法",
  "① ニックネームと基本情報を2行で入力し、通常のメッセージとして送信します。",
  "② 下の7つのボタンからポジションを1つ選びます。",
  "③ 入力内容をプレビューで確認し、必要なら修正します。",
  "",
  "✏️ 入力例（2行まとめて送信）",
  "ゼロ",
  "175 80 40",
  "",
  "1行目：ニックネーム",
  "2行目：身長(cm)・体重(kg)・年齢(歳)",
  "数字の区切り：半角スペース・/・#・-",
  "入力範囲：身長100〜250cm／体重50〜250kg／年齢18〜89歳",
  "",
  "入力を間違えても、もう一度送信できます。",
  "数字入力とボタン選択はどちらが先でも大丈夫です。",
  "",
  "ポジションを選んでください。",
].join("\n");

const overviewKeyboard=(revision:number)=>Markup.inlineKeyboard(
  profileOverviewButtons(revision).map(row=>row.map(button=>
    Markup.button.callback(button.text,button.callback_data)))
);
/** The ② summary has exactly four adjacent buttons, with no filler. */
const saveSectionButton=(rev:number)=>Markup.button.callback("保存",`pf:section:${rev}:save`);
const appearanceKeyboard=(revision:number)=>Markup.inlineKeyboard([
 [
  Markup.button.callback("髪型",`pf:ap:${revision}:open:h`),
  Markup.button.callback("体型",`pf:ap:${revision}:open:b`),
  Markup.button.callback("エリア",`pf:ap:${revision}:area`),
  Markup.button.callback("戻る",`pf:ap:${revision}:back`),
 ],
 [saveSectionButton(revision)],
]);
const appearanceText=(data:ProfileDraft["data"])=>[
  "🪪 プロフィール｜容姿/エリア",
  "髪型："+(data.hair||"未設定"),
  "体型："+(data.body||"未設定"),
  "エリア："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
  "",
  "髪型・体型・エリアは任意です。変更したい項目を選んでください。",
  "［戻る］でプロフィール一覧へ。［保存］は①〜⑤をまとめて非公開保存します。",
].join("\n");
const choiceKeyboard=(kind:"h"|"b",revision:number,data:ProfileDraft["data"])=>{
 const rows=kind==="h"
  ?selectionRows(HAIR_ROWS,data.hair?[data.hair]:[],
    v=>`pf:ap:${revision}:h:${HAIR_CHOICES.indexOf(v)}`)
  :selectionRows(BODY_ROWS,data.body?[data.body]:[],
    v=>`pf:ap:${revision}:b:${BODY_CHOICES.indexOf(v)}`);
 const styled=rows.map(row=>row.map(b=>({
   ...Markup.button.callback(b.text,b.callback_data),
   style:kind==="h"?"primary" as const:"success" as const,
 })));
 return Markup.inlineKeyboard([
   ...styled.slice(0,-1),
   [...styled[styled.length-1]!,
    Markup.button.callback("↩ 戻る",`pf:ap:${revision}:back`)],
   [saveSectionButton(revision)],
 ]);
};
const choiceText=(kind:"h"|"b",data:ProfileDraft["data"])=>
  [
    kind==="h"?"💈 髪型を選択してください":"💪 体型を選択してください",
    "現在："+(kind==="h"?(data.hair||"未設定"):(data.body||"未設定")),
    "任意で1つ選択。✅選択中／▫️未選択。同じ候補で解除できます。",
    "［↩ 戻る］で容姿/エリアの一覧へ。［保存］は①〜⑤すべてを非公開で保存します。",
  ].join("\n");

/** Region IDs are independent of any Telegram topic IDs or deep links. */
const areaBlocksKeyboard=(revision:number,data:ProfileDraft["data"])=>{
 const rows=areaButtonRows(PROFILE_AREA_BLOCKS,"↩ 戻る");
 return Markup.inlineKeyboard([
 ...rows.map(row=>row.map(label=>{
  if(label==="↩ 戻る")return Markup.button.callback(label,`pf:ar:${revision}:back`);
  const index=PROFILE_AREA_BLOCKS.indexOf(label as ProfileAreaBlock);
  const checked=data.region===label&&data.area!=null;
  return Markup.button.callback((checked?"✅ ":"▫️ ")+label,
   `pf:ar:${revision}:r:${index}`);
 })),[saveSectionButton(revision)],
 ]);
};
const areaBlocksText=(data:ProfileDraft["data"])=>[
 "📍 エリアを選択してください",
 "現在："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
 "全国13ブロックから地域を選び、その中のエリアを1つ選択してください。",
 "北海道・沖縄は直接選択・解除できます。別の地域を見るだけでは現在の選択は消えません。",
 "✅選択中／▫️未選択。［↩ 戻る］で容姿/エリアの一覧へ。［保存］で全項目を非公開保存します。",
].join("\n");
const areaChildrenKeyboard=(revision:number,data:ProfileDraft["data"])=>{
 const block=data.pendingRegion;
 if(!block)throw Error("PROFILE_AREA_BLOCK_MISSING");
 const options=areaChildren(block);
 return Markup.inlineKeyboard([
 ...areaButtonRows(options).map(row=>row.map(label=>{
  if(label==="↩ 戻る")return Markup.button.callback(label,`pf:ar:${revision}:back`);
  const index=options.indexOf(label);
  return Markup.button.callback((data.region===block&&data.area===label?"✅ ":"▫️ ")+label,
   `pf:ar:${revision}:a:${index}`);
 })),[saveSectionButton(revision)],
 ]);
};
const areaChildrenText=(data:ProfileDraft["data"])=>[
 "📍 "+data.pendingRegion+"｜エリアを選択",
 "現在："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
 "エリアを1つ選択してください。✅選択中／▫️未選択。同じエリアの再押下で解除、別候補で変更できます。",
 "［↩ 戻る］で全国13ブロックへ。［保存］で全項目を非公開保存します。",
].join("\n");

const profileTagPurpose=(data:ProfileDraft["data"]):ProfileTagPurpose=>data.tagPurpose==="love"?"love":"like";
const tagValues=(data:ProfileDraft["data"])=>
 profileTagPurpose(data)==="love"?(data.loveTags??[]):(data.likeTags??[]);
const tagCategoryKeyboard=(rev:number,data:ProfileDraft["data"])=>Markup.inlineKeyboard(
 likeCategoryRows(rev,tagValues(data),profileTagPurpose(data))
 .map(row=>row.map(b=>Markup.button.callback(b.text,b.callback_data))));
const tagItemKeyboard=(rev:number,data:ProfileDraft["data"])=>Markup.inlineKeyboard(
 likeItemRows(rev,data.likeCategory!,data.likePage??0,tagValues(data),profileTagPurpose(data))
 .map(row=>row.map(b=>Markup.button.callback(b.text,b.callback_data))));
const tagCategoryText=(data:ProfileDraft["data"])=>[
 "🏷️ #"+(profileTagPurpose(data)==="love"?"Love":"Like"),
 tagPurposeDescription(profileTagPurpose(data)),
 "複数選択。カテゴリー間・ページ間も選択は保持されます。",
 "選択中："+tagValues(data).length+"件",
 "［↩ 戻る］でプロフィール一覧へ。［保存］は非公開保存です。",
].join("\n");
const tagItemText=(data:ProfileDraft["data"])=>{
 const cat=LIKE_CATEGORIES[data.likeCategory!];
 return [
  "🏷️ #"+(profileTagPurpose(data)==="love"?"Love":"Like")+"｜"+cat.name,
  tagPurposeDescription(profileTagPurpose(data)),
  "ページ "+((data.likePage??0)+1)+"/"+Math.ceil(cat.items.length/12),
  "複数選択：✅選択中／▫️未選択。同じ項目を押すと解除。",
  "この分類："+tagValues(data).filter(t=>t.category===cat.name).length+"件",
  "［この分類を解除］はこの分類の選択だけを解除します。",
  "［↩ 戻る］でカテゴリー一覧へ。［保存］は全カテゴリーの選択を非公開保存します。",
 ].join("\n");
};
const mediaKeyboard=(rev:number)=>Markup.inlineKeyboard([[
 Markup.button.callback("↩ 戻る",`pf:media:${rev}:back`),saveSectionButton(rev),
]]);
const mediaText=(data:ProfileDraft["data"])=>{
 const media=numberProfileMedia(data.media);
 const pages=Math.max(1,Math.ceil(media.length/40));
 const page=Math.min(Math.max(data.mediaPage??1,1),pages);
 return [
  "🪪 プロフィール｜画像・動画・自己PR",
  "画像・動画はTelegramの添付機能からこのBot DMへ送信してください（登録は任意）。",
  "自己PRは通常の入力欄へ送信。再送信すると全文差し替えです。",
  "画像・動画は「削除 番号」「差替 番号」で操作します（例：差替 1）。",
  "自己PRの消去は「PR削除」、差し替え中止は「差替取消」と送信します。",
  "複数ページの一覧は「一覧 ページ番号」（例：一覧 2）で表示します。",
  "入力メッセージはBotが削除を試みます。失敗した場合は手動で削除してください。",
  "［↩ 戻る］でプロフィール一覧へ。［保存］は①〜⑤すべての入力を非公開保存します。",
  ...(data.replaceMediaId?["","🔁 No."+data.replaceMediaId+" の差替画像・動画を送信してください。中止は 差替取消 と送信。"]:[]),
  "",
  ...mediaStatus(media,data.pr),
  ...media.slice((page-1)*40,page*40).map(item=>"No."+item.itemId+" "+(item.type==="photo"?"🖼️画像":"🎬動画")),
  ...(pages>1?["一覧 "+page+"/"+pages+"ページ。ほかは 一覧 ページ番号 と送信。"]:[]),
 ].join("\n");
};
const overviewText=(profile:SavedProfile,username:string)=>[
  "🪪 プロフィールプレビュー",
  renderProfileBasicPreview(profile,username),
  "",
  "基本情報以外の項目は任意です。登録したい項目を下のボタンから選んでください。",
  "容姿/エリア、画像・動画/自己PR、#Like（自分の特徴・好み）、#Love（相手に求めること）を編集できます。",
  "［プレビュー］で確認し、［保存］で全項目を保存します。保存だけではグループへ投稿されません。",
  "既に公開している場合、更新には別途 /publishprofile で投稿先と内容の確認が必要です。",
  "［キャンセル］は未保存の変更だけを取り消し、投稿メニューへ戻ります。保存済み内容は削除しません。",
].join("\n");

function basicPrompt(position?: string): string {
  return requestBasic + (position ? "\n\n✅ 選択中：" + position + "（基本情報も送信してください）" : "");
}

/** Telegram private messages are the only source of wizard text input. */
async function updateWizardScreen(ctx: Context, repo: ProfileRepo, draft: ProfileDraft,
 text: string, markup: ReturnType<typeof Markup.inlineKeyboard>, parseMode?: "HTML"
): Promise<void> {
 const chatId = ctx.chat?.id;
 if (chatId === undefined || !ctx.from) throw new Error("PROFILE_CHAT_MISSING");
 const opts = {...markup, ...(parseMode ? {parse_mode: parseMode} : {})};
 const oldId = draft.data.screenMessageId;
 if (oldId) {
   try {
     await ctx.telegram.editMessageText(chatId, oldId, undefined, text, opts);
     return;
   } catch (error) {
     // A deleted/expired screen can be replaced without abandoning the draft.
     // Do not log the user's profile text or reveal it to other chats.
     console.warn("[PROFILE_SCREEN_EDIT_FAILED]", error instanceof Error ? error.message : "unknown");
   }
 }
 const sent = await ctx.reply(text, opts);
 await repo.bindScreenMessage(ctx.from.id, draft.revision, sent.message_id);
 if (oldId && oldId !== sent.message_id) {
   try { await ctx.telegram.deleteMessage(chatId, oldId); }
   catch { console.warn("[PROFILE_OLD_SCREEN_DELETE_FAILED]"); }
 }
}

function canUseProfile(ctx: {chat?: {type: string}; from?: {username?: string}}): boolean {
  return ctx.chat?.type === "private" && !!ctx.from?.username;
}

/** Shared entrypoint for /profile and validated M2 Topic→DM start links. */
export async function startProfileEditor(ctx:Context,repo:ProfileRepo=profileRepo):Promise<void>{
 if(ctx.chat?.type!=="private"||!ctx.from)return;
 if(!canUseProfile(ctx)){
  await ctx.reply("Telegram設定でusernameを登録してから操作してください。");
  return;
 }
 const existing=await repo.getProfile(ctx.from.id);
 const previous=await repo.getDraft(ctx.from.id);
 // Preserve the active profile draft when a start link is reopened, including
 // after a Bot restart. Never reset an in-progress wizard on /profile.
 if(previous){
   const text=previous.step==="like-categories"?tagCategoryText(previous.data)
     :previous.step==="like-items"?tagItemText(previous.data)
     :previous.step==="media"?mediaText(previous.data)
     :previous.step==="area-blocks"?areaBlocksText(previous.data)
     :previous.step==="area-children"?areaChildrenText(previous.data)
     :previous.step==="hair"||previous.step==="body"
     ?choiceText(previous.step==="hair"?"h":"b",previous.data)
     :previous.step==="appearance"
       ?appearanceText(previous.data)
     :previous.step==="preview"
     ? overviewText(previous.data as SavedProfile,ctx.from.username!)
     :previous.step==="awaiting_position"
       ?"✅ 基本情報を受け付けました。\n下の7つのボタンからポジションを1つ選択してください。\n✅が現在の選択です。別の候補を押すと選び直せます。\n選択するとプロフィール一覧に進みます。"
       :basicPrompt(previous.data.position);
   const markup=previous.step==="like-categories"?tagCategoryKeyboard(previous.revision,previous.data)
     :previous.step==="like-items"?tagItemKeyboard(previous.revision,previous.data)
     :previous.step==="media"?mediaKeyboard(previous.revision)
     :previous.step==="area-blocks"?areaBlocksKeyboard(previous.revision,previous.data)
     :previous.step==="area-children"?areaChildrenKeyboard(previous.revision,previous.data)
     :previous.step==="hair"||previous.step==="body"
     ?choiceKeyboard(previous.step==="hair"?"h":"b",previous.revision,previous.data)
     :previous.step==="appearance"
       ?appearanceKeyboard(previous.revision)
     :previous.step==="preview"
     ?overviewKeyboard(previous.revision)
     :selectPosition(previous.revision,previous.data.position);
   await updateWizardScreen(ctx,repo,previous,text,markup,
     previous.step==="preview"?"HTML":undefined);
   return;
 }
 const lastId=await repo.getLastScreenMessageId(ctx.from.id);
 if(existing){
   if(existing.status==="private"||existing.status==="published"){
     const draft=await repo.putDraft(ctx.from.id,"preview",{
       nickname:existing.nickname,heightCm:existing.heightCm,
       weightKg:existing.weightKg,age:existing.age,position:existing.position,
       hair:existing.hair,body:existing.body,region:existing.region,area:existing.area,
       pr:existing.pr,media:existing.media,mediaNextId:existing.mediaNextId,
      likeTags:existing.likeTags,loveTags:existing.loveTags,
       ...(lastId?{screenMessageId:lastId}:{}),
     });
     await updateWizardScreen(ctx,repo,draft,
       overviewText(existing,ctx.from.username!),
       overviewKeyboard(draft.revision),"HTML");
     return;
   }
   // A published original must not be silently made editable without synchronizing posts.
   await ctx.reply("🪪 公開済みプロフィール\n公開先との同期が未接続のため、ここからの直接編集・上書き保存はできません。\n\n"+renderProfileBasicPreview(existing,ctx.from.username!),{
     parse_mode:"HTML",...Markup.inlineKeyboard([
       [Markup.button.callback("📝 基本情報を編集","pf:edit:basic")],
     ]),
   });
   return;
 }
 const draft=await repo.putDraft(ctx.from.id,"awaiting_basic",
   lastId?{screenMessageId:lastId}:{});
 await updateWizardScreen(ctx,repo,draft,basicPrompt(),selectPosition(draft.revision));
}

export function registerProfileHandlers(
  bot: Telegraf,
  repo: ProfileRepo = profileRepo,
  activeDmOwner:typeof currentDmTextOwner=currentDmTextOwner,
): void {
  bot.command("profile", async ctx => startProfileEditor(ctx,repo));

  /** Editing one Bot-owned screen, never a synthetic posting-menu URL. */
  const returnToPostingMenu=async(ctx:Context):Promise<void>=>{
    if(!ctx.from)return;
    await editMessageToDmPostingMenu(ctx,ctx.from.id);
  };

  /** Single persistence pathway for A, ②, ③, ④, ⑤ and legacy Save.
   * All section fields are saved together, never only the selected section.
   */
  const persistCompleteProfile=async(ctx:Context,draft:ProfileDraft):Promise<void>=>{
    if(!ctx.from?.username)throw Error("PROFILE_ACTOR_MISSING");
    const saved=await repo.savePrivateDraft(ctx.from.id,draft.revision,ctx.from.username);
    const next=await repo.putDraft(ctx.from.id,"preview",{
      nickname:saved.nickname,heightCm:saved.heightCm,weightKg:saved.weightKg,
      age:saved.age,position:saved.position,hair:saved.hair,body:saved.body,
      region:saved.region,area:saved.area,pr:saved.pr,prRef:saved.prRef,
      media:saved.media,mediaNextId:saved.mediaNextId,
      likeTags:saved.likeTags,loveTags:saved.loveTags,
      screenMessageId:draft.data.screenMessageId,
    });
    const message=saved.status==="published"
      ?"✅ ①〜⑤の変更を保存しました。公開中の投稿は自動更新されません。公開を更新するには /publishprofile で対象と内容を確認してください。"
      :"✅ プロフィール①〜⑤の入力済み内容を非公開保存しました。グループには投稿していません。";
    await ctx.answerCbQuery("①〜⑤を保存しました");
    await ctx.editMessageText(message+"\\n"+overviewText(saved,ctx.from.username),{
      parse_mode:"HTML",...overviewKeyboard(next.revision)});
  };

  bot.action(/^pf:cancel:(\d+)$/, async (ctx) => {
    if (!canUseProfile(ctx)) return;
    const revision = Number(ctx.match[1]);
    const cancelled = await repo.discardDraft(ctx.from.id, revision);
    if (!cancelled) {
      await ctx.answerCbQuery("古い画面です。最新の画面から操作してください。");
      return;
    }
    await ctx.answerCbQuery();
    await returnToPostingMenu(ctx);
  });

  bot.action("pf:restart", async (ctx) => {
    if (!canUseProfile(ctx)) return;
    const existing = await repo.getProfile(ctx.from.id);
    if (existing) {
      await ctx.answerCbQuery("保存済みプロフィールがあります");
      await ctx.editMessageText("🪪 保存済みプロフィール\n基本情報の編集は下のボタンから行えます。\n\n"+renderProfileBasicPreview(existing, ctx.from.username!), {
        parse_mode:"HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("📝 基本情報を編集","pf:edit:basic")]]),
      });
      return;
    }
    const current = await repo.getDraft(ctx.from.id);
    if (current) {
      await ctx.answerCbQuery("すでに入力中です");
      return;
    }
    const draft = await repo.putDraft(ctx.from.id,"awaiting_basic",{});
    const messageId = ctx.callbackQuery.message && "message_id" in ctx.callbackQuery.message
      ? ctx.callbackQuery.message.message_id : undefined;
    if (messageId) await repo.bindScreenMessage(ctx.from.id,draft.revision,messageId);
    await ctx.answerCbQuery();
    await ctx.editMessageText(basicPrompt(),selectPosition(draft.revision));
  });

  bot.action("pf:edit:basic", async (ctx) => {
    await ctx.answerCbQuery();
    if (!canUseProfile(ctx)) return;
    const existing = await repo.getProfile(ctx.from.id);
    if (!existing || !["private","published"].includes(existing.status)) {
      await ctx.reply("このプロフィールは現在編集できません。");
      return;
    }
    const draft = await repo.putDraft(ctx.from.id, "awaiting_basic", {
      screenMessageId: ctx.callbackQuery.message && "message_id" in ctx.callbackQuery.message ? ctx.callbackQuery.message.message_id : undefined,
      nickname: existing.nickname,
      heightCm: existing.heightCm,
      weightKg: existing.weightKg,
      age: existing.age,
      position: existing.position,
      hair:existing.hair,body:existing.body,region:existing.region,area:existing.area,
      pr:existing.pr,media:existing.media,mediaNextId:existing.mediaNextId,
      likeTags:existing.likeTags,loveTags:existing.loveTags,
    });
    await ctx.editMessageText(basicPrompt(existing.position), selectPosition(draft.revision,existing.position));
  });

  bot.action(/^pf:pos:(\d+):([0-6])$/, async (ctx) => {
    if (!canUseProfile(ctx)) return;
    const callbackRevision = Number(ctx.match[1]);
    const index = Number(ctx.match[2]);
    const draft = await repo.getDraft(ctx.from.id);
    if (!draft || !["awaiting_basic", "awaiting_position"].includes(draft.step) ||
        draft.revision !== callbackRevision) {
      await ctx.answerCbQuery("前の操作です。プロフィールを開き直してください。");
      return;
    }
    const position = nextSelection("single-required",
      draft.data.position?[draft.data.position]:[],PROFILE_POSITIONS[index],PROFILE_POSITIONS)[0]!;

    // A complete required profile can change ONLY its position and return
    // to overview without forcing the nickname/three numeric fields again.
    const basicComplete=typeof draft.data.nickname==="string"&&
      draft.data.nickname.trim().length>0&&
      [draft.data.heightCm,draft.data.weightKg,draft.data.age].every(
        n=>typeof n==="number"&&Number.isFinite(n));
    if(draft.step==="awaiting_basic"&&basicComplete){
      const updated=await repo.putDraft(ctx.from.id,"preview",
        {...draft.data,position},draft.revision);
      await ctx.answerCbQuery("ポジションを更新しました");
      await ctx.editMessageText(overviewText(updated.data as SavedProfile,ctx.from.username!),
        {parse_mode:"HTML",...overviewKeyboard(updated.revision)});
      return;
    }
    if (draft.step === "awaiting_basic") {
      const updated = await repo.putDraft(ctx.from.id, "awaiting_basic",
        {...draft.data, position}, draft.revision);
      await ctx.answerCbQuery("ポジションを選択しました");
      await ctx.editMessageText(basicPrompt(position), selectPosition(updated.revision,position));
      return;
    }
    const updated = await repo.putDraft(ctx.from.id, "preview",
      {...draft.data, position}, draft.revision);
    await ctx.answerCbQuery();
    await ctx.editMessageText(overviewText(updated.data as SavedProfile,ctx.from.username!),
      {parse_mode:"HTML",...overviewKeyboard(updated.revision)});
  });

  bot.action(/^pf:overview:(\d+):(basic|appearance|media|like|love|preview|save|cancel)$/, async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]);
    const action=ctx.match[2];
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.revision!==revision||draft.step!=="preview"){
      await ctx.answerCbQuery("古い画面です。プロフィールを開き直してください。");
      return;
    }
    if(action==="basic"){
      const updated=await repo.putDraft(ctx.from.id,"awaiting_basic",draft.data,draft.revision);
      await ctx.answerCbQuery();
      await ctx.editMessageText(basicPrompt(draft.data.position),selectPosition(updated.revision,draft.data.position));
      return;
    }
    if(action==="appearance"){
      const updated=await repo.putDraft(ctx.from.id,"appearance",draft.data,draft.revision);
      await ctx.answerCbQuery();
      await ctx.editMessageText(appearanceText(updated.data),
        appearanceKeyboard(updated.revision));
      return;
    }
    if(action==="media"){
      const updated=await repo.putDraft(ctx.from.id,"media",draft.data,draft.revision);
      await ctx.answerCbQuery();
      await ctx.editMessageText(mediaText(updated.data),mediaKeyboard(updated.revision));
      return;
    }
    if(action==="like"||action==="love"){
      const updated=await repo.putDraft(ctx.from.id,"like-categories",
        {...draft.data,tagPurpose:action,likeTags:validLikeTags(draft.data.likeTags??[]),
         loveTags:validLikeTags(draft.data.loveTags??[])},draft.revision);
      await ctx.answerCbQuery();
      await ctx.editMessageText(tagCategoryText(updated.data),tagCategoryKeyboard(updated.revision,updated.data));
      return;
    }
    if(action==="preview"){
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        "🪪 プロフィール公開前プレビュー（まだ非公開）\n"+
        renderProfileBasicPreview(draft.data as SavedProfile,ctx.from.username!)+
        "\n\nここは確認用画面です。［↩ プロフィール編集に戻る］で項目の修正へ戻れます。\n保存だけでは公開されません。グループへの投稿も行いません。",
        {parse_mode:"HTML",...Markup.inlineKeyboard([
          [Markup.button.callback("↩ プロフィール編集に戻る",
            "pf:overview:"+draft.revision+":return")]
        ])});
      return;
    }
    if(action==="save"){
      await persistCompleteProfile(ctx,draft);
      return;
    }
    if(action==="cancel"){
      const cancelled=await repo.discardDraft(ctx.from.id,draft.revision);
      if(!cancelled){await ctx.answerCbQuery("古い操作です");return;}
      await ctx.answerCbQuery();
      await returnToPostingMenu(ctx);
      return;
    }
    await ctx.answerCbQuery("この項目の設定画面は次に実装します。");
  });

  const tagActions:ProfileTagPurpose[]=["like","love"];
  for(const purpose of tagActions){
    const prefix="pf:"+purpose+":";
    bot.action(new RegExp("^"+prefix+"(\\d+):open:([0-5])$"),async ctx=>{
      if(!canUseProfile(ctx))return;
      const draft=await repo.getDraft(ctx.from.id),rev=Number(ctx.match[1]),category=Number(ctx.match[2]);
      if(!draft||draft.step!=="like-categories"||draft.revision!==rev||profileTagPurpose(draft.data)!==purpose){
        await ctx.answerCbQuery("古い画面です");return;
      }
      const updated=await repo.putDraft(ctx.from.id,"like-items",{...draft.data,likeCategory:category,likePage:0},rev);
      await ctx.answerCbQuery();
      await ctx.editMessageText(tagItemText(updated.data),tagItemKeyboard(updated.revision,updated.data));
    });
    bot.action(new RegExp("^"+prefix+"(\\d+):tag:([0-5]):(\\d{1,2})$"),async ctx=>{
      if(!canUseProfile(ctx))return;
      const draft=await repo.getDraft(ctx.from.id),rev=Number(ctx.match[1]),category=Number(ctx.match[2]),tag=Number(ctx.match[3]);
      if(!draft||draft.step!=="like-items"||draft.revision!==rev||profileTagPurpose(draft.data)!==purpose||
         draft.data.likeCategory!==category||likePageIndex(category,tag)!==(draft.data.likePage??0)||
         tag>=LIKE_CATEGORIES[category].items.length){
        await ctx.answerCbQuery("古い画面または無効な項目です");return;
      }
      const value=toggleLike(tagValues(draft.data),category,tag);
      const updated=await repo.putDraft(ctx.from.id,"like-items",{
        ...draft.data,...(purpose==="like"?{likeTags:value}:{loveTags:value})},rev);
      await ctx.answerCbQuery();
      await ctx.editMessageText(tagItemText(updated.data),tagItemKeyboard(updated.revision,updated.data));
    });
    bot.action(new RegExp("^"+prefix+"(\\d+):page:([0-5]):(-?\\d{1,2})$"),async ctx=>{
      if(!canUseProfile(ctx))return;
      const draft=await repo.getDraft(ctx.from.id),rev=Number(ctx.match[1]),category=Number(ctx.match[2]),page=Number(ctx.match[3]);
      if(!draft||draft.step!=="like-items"||draft.revision!==rev||profileTagPurpose(draft.data)!==purpose||
         draft.data.likeCategory!==category||Math.abs(page-(draft.data.likePage??0))!==1||
         page<0||page>=Math.ceil(LIKE_CATEGORIES[category].items.length/12)){
        await ctx.answerCbQuery("古い画面または無効なページです");return;
      }
      const updated=await repo.putDraft(ctx.from.id,"like-items",{...draft.data,likePage:page},rev);
      await ctx.answerCbQuery();
      await ctx.editMessageText(tagItemText(updated.data),tagItemKeyboard(updated.revision,updated.data));
    });
    bot.action(new RegExp("^"+prefix+"(\\d+):clear:([0-5])$"),async ctx=>{
      if(!canUseProfile(ctx))return;
      const draft=await repo.getDraft(ctx.from.id),rev=Number(ctx.match[1]),category=Number(ctx.match[2]);
      if(!draft||draft.step!=="like-items"||draft.revision!==rev||
         profileTagPurpose(draft.data)!==purpose||draft.data.likeCategory!==category){
        await ctx.answerCbQuery("古い画面です");return;
      }
      const remaining=tagValues(draft.data).filter(t=>t.category!==LIKE_CATEGORIES[category].name);
      const updated=await repo.putDraft(ctx.from.id,"like-items",{
        ...draft.data,...(purpose==="like"?{likeTags:remaining}:{loveTags:remaining})},rev);
      await ctx.answerCbQuery("この分類を解除しました");
      await ctx.editMessageText(tagItemText(updated.data),tagItemKeyboard(updated.revision,updated.data));
    });
    bot.action(new RegExp("^"+prefix+"(\\d+):back$"),async ctx=>{
      if(!canUseProfile(ctx))return;
      const draft=await repo.getDraft(ctx.from.id),rev=Number(ctx.match[1]);
      if(!draft||draft.revision!==rev||profileTagPurpose(draft.data)!==purpose||
         !["like-items","like-categories"].includes(draft.step)){
        await ctx.answerCbQuery("古い画面です");return;
      }
      const fromItems=draft.step==="like-items";
      const updated=await repo.putDraft(ctx.from.id,fromItems?"like-categories":"preview",draft.data,rev);
      await ctx.answerCbQuery();
      if(fromItems)await ctx.editMessageText(tagCategoryText(updated.data),tagCategoryKeyboard(updated.revision,updated.data));
      else await ctx.editMessageText(overviewText(updated.data as SavedProfile,ctx.from.username!),{
        parse_mode:"HTML",...overviewKeyboard(updated.revision)});
    });
    bot.action(new RegExp("^"+prefix+"(\\d+):save$"),async ctx=>{
      if(!canUseProfile(ctx))return;
      const draft=await repo.getDraft(ctx.from.id),rev=Number(ctx.match[1]);
      if(!draft||draft.revision!==rev||profileTagPurpose(draft.data)!==purpose||
         !["like-items","like-categories"].includes(draft.step)){
        await ctx.answerCbQuery("古い保存ボタンです");return;
      }
      await persistCompleteProfile(ctx,draft);
    });
  }

  // All optional section screens share the same full-profile private save.
  // Incomplete initial basic registration never exposes this action.
  bot.action(/^pf:section:(\d+):save$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.revision!==revision||![
      "appearance","hair","body","area-blocks","area-children","media",
    ].includes(draft.step)){
      await ctx.answerCbQuery("古い保存ボタンです");return;
    }
    await persistCompleteProfile(ctx,draft);
  });

  bot.action(/^pf:ap:(\d+):open:([hb])$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]);
    const kind=ctx.match[2] as "h"|"b";
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.step!=="appearance"||draft.revision!==revision){
      await ctx.answerCbQuery("古い画面です");
      return;
    }
    const updated=await repo.putDraft(ctx.from.id,kind==="h"?"hair":"body",
      draft.data,draft.revision);
    await ctx.answerCbQuery();
    await ctx.editMessageText(choiceText(kind,updated.data),
      choiceKeyboard(kind,updated.revision,updated.data));
  });
  bot.action(/^pf:ap:(\d+):area$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.step!=="appearance"||draft.revision!==revision){
      await ctx.answerCbQuery("古い画面です");return;
    }
    const updated=await repo.putDraft(ctx.from.id,"area-blocks",
      draft.data,draft.revision);
    await ctx.answerCbQuery();
    await ctx.editMessageText(areaBlocksText(updated.data),
      areaBlocksKeyboard(updated.revision,updated.data));
  });
  bot.action(/^pf:ar:(\d+):r:(\d{1,2})$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]),index=Number(ctx.match[2]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.step!=="area-blocks"||draft.revision!==revision){
      await ctx.answerCbQuery("古い画面です");return;
    }
    const block=PROFILE_AREA_BLOCKS[index];
    if(!block){await ctx.answerCbQuery("地域が見つかりません");return;}
    const options=areaChildren(block);
    if(options.length===1){
      const values=toggleProfileArea(draft.data,block,options[0]!);
      const updated=await repo.putDraft(ctx.from.id,"area-blocks",
       {...draft.data,...values},draft.revision);
      await ctx.answerCbQuery(values.area?"エリアを選択しました":"選択を解除しました");
      await ctx.editMessageText(areaBlocksText(updated.data),
        areaBlocksKeyboard(updated.revision,updated.data));
    }else{
      // Previewing a different block cannot leave a mismatched region-child pair.
      // The old pair stays intact until a new child is explicitly committed.
      const updated=await repo.putDraft(ctx.from.id,"area-children",
       {...draft.data,pendingRegion:block},draft.revision);
      await ctx.answerCbQuery();
      await ctx.editMessageText(areaChildrenText(updated.data),
        areaChildrenKeyboard(updated.revision,updated.data));
    }
  });
  bot.action(/^pf:ar:(\d+):a:(\d{1,2})$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]),index=Number(ctx.match[2]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.step!=="area-children"||draft.revision!==revision||
       !draft.data.pendingRegion){
      await ctx.answerCbQuery("古い画面です");return;
    }
    const block=draft.data.pendingRegion;
    const child=areaChildren(block)[index];
    if(!child){await ctx.answerCbQuery("エリアが見つかりません");return;}
    const values=toggleProfileArea(draft.data,block,child);
    const updated=await repo.putDraft(ctx.from.id,"area-children",
       {...draft.data,...values,pendingRegion:block},draft.revision);
    await ctx.answerCbQuery(values.area?"エリアを選択しました":"選択を解除しました");
    await ctx.editMessageText(areaChildrenText(updated.data),
      areaChildrenKeyboard(updated.revision,updated.data));
  });
  bot.action(/^pf:ar:(\d+):back$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||!["area-blocks","area-children"].includes(draft.step)||
       draft.revision!==revision){await ctx.answerCbQuery("古い画面です");return;}
    const toBlocks=draft.step==="area-children";
    const updated=await repo.putDraft(ctx.from.id,toBlocks?"area-blocks":"appearance",
      {...draft.data,pendingRegion:null},draft.revision);
    await ctx.answerCbQuery();
    await ctx.editMessageText(toBlocks?areaBlocksText(updated.data):appearanceText(updated.data),
      toBlocks?areaBlocksKeyboard(updated.revision,updated.data):appearanceKeyboard(updated.revision));
  });
  bot.action(/^pf:ap:(\d+):([hb]):(\d{1,2})$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]),kind=ctx.match[2] as "h"|"b",index=Number(ctx.match[3]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.step!==(kind==="h"?"hair":"body")||draft.revision!==revision){
      await ctx.answerCbQuery("古い画面です。最新の画面から操作してください。");
      return;
    }
    let changed:ProfileDraft["data"];
    let selected:boolean;
    if(kind==="h"){
      const clicked=HAIR_CHOICES[index];
      if(!clicked){await ctx.answerCbQuery("選択肢がありません");return;}
      const hair=nextSelection("single-optional",
        draft.data.hair?[draft.data.hair]:[],clicked,HAIR_CHOICES)[0]??null;
      changed={...draft.data,hair};
      selected=!!hair;
    }else{
      const clicked=BODY_CHOICES[index];
      if(!clicked){await ctx.answerCbQuery("選択肢がありません");return;}
      const body=nextSelection("single-optional",
        draft.data.body?[draft.data.body]:[],clicked,BODY_CHOICES)[0]??null;
      changed={...draft.data,body};
      selected=!!body;
    }
    const updated=await repo.putDraft(ctx.from.id,kind==="h"?"hair":"body",changed,draft.revision);
    await ctx.answerCbQuery(selected?"選択しました":"選択を解除しました");
    await ctx.editMessageText(choiceText(kind,updated.data),
      choiceKeyboard(kind,updated.revision,updated.data));
  });
  bot.action(/^pf:ap:(\d+):back$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||!["appearance","hair","body"].includes(draft.step)||draft.revision!==revision){
      await ctx.answerCbQuery("古い画面です。最新の画面から操作してください。");
      return;
    }
    const toSummary=draft.step==="hair"||draft.step==="body";
    const updated=await repo.putDraft(ctx.from.id,toSummary?"appearance":"preview",
      draft.data,draft.revision);
    await ctx.answerCbQuery();
    if(toSummary){
      await ctx.editMessageText(appearanceText(updated.data),
        appearanceKeyboard(updated.revision));
    }else{
      await ctx.editMessageText(overviewText(updated.data as SavedProfile,ctx.from.username!),
        {parse_mode:"HTML",...overviewKeyboard(updated.revision)});
    }
  });

  bot.action(/^pf:overview:(\d+):return$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const revision=Number(ctx.match[1]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.revision!==revision||draft.step!=="preview"){
      await ctx.answerCbQuery("この画面は古くなっています");
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(overviewText(draft.data as SavedProfile,ctx.from.username!),
      {parse_mode:"HTML",...overviewKeyboard(draft.revision)});
  });

  bot.action(/^pf:media:(\d+):back$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const d=await repo.getDraft(ctx.from.id);
    if(!d||d.step!=="media"||d.revision!==Number(ctx.match[1])){await ctx.answerCbQuery("古い画面です");return;}
    const u=await repo.putDraft(ctx.from.id,"preview",d.data,d.revision);
    await ctx.answerCbQuery();
    await ctx.editMessageText(overviewText(u.data as SavedProfile,ctx.from.username!),{parse_mode:"HTML",...overviewKeyboard(u.revision)});
  });
  // Legacy callback from the original basic form; keep compatible with
  // already issued buttons, but render the adopted 3/3/2 screen afterward.
  bot.action(/^pf:save:(\d+)$/,async ctx=>{
    if(!canUseProfile(ctx))return;
    const rev=Number(ctx.match[1]);
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.step!=="preview"||draft.revision!==rev){
      await ctx.answerCbQuery("古い保存ボタンです");
      return;
    }
    await persistCompleteProfile(ctx,draft);
  });

  // Register BEFORE the pre-existing admin message handler. All other
  // messages must continue through the established approval/admin route.
  bot.on("text", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !ctx.from?.username ||
        ctx.message.text.startsWith("/")) return next();
    if(await activeDmOwner(ctx.from.id)!=="profile")return next();
    const draft = await repo.getDraft(ctx.from.id);
    if (!draft)return next();
    if(draft.step==="media"){
      const value=ctx.message.text.trim();
      const match=/^(削除|差替)\s*(\d+)$/.exec(value);
      let next= draft.data;
      let warning="";
      if(match){
        const itemId=Number(match[2]);
        const current=numberProfileMedia(draft.data.media);
        if(!Number.isSafeInteger(itemId)||!current.some(item=>item.itemId===itemId)){
          warning="⚠️ 指定した番号は登録されていません。";
        }else if(match[1]==="削除"){
          next={...draft.data,media:deleteProfileMedia(current,itemId),replaceMediaId:undefined};
        }else{
          next={...draft.data,media:current,replaceMediaId:itemId};
        }
      }else if(/^一覧\s*\d+$/.test(value)){
        const page=Number(value.replace(/^一覧\s*/,""));
        const pages=Math.max(1,Math.ceil((draft.data.media?.length??0)/40));
        if(!Number.isSafeInteger(page)||page<1||page>pages){
          warning="⚠️ 存在しない一覧ページです。";
        }else{
          next={...draft.data,mediaPage:page};
        }
      }else if(value==="PR削除"){
        next={...draft.data,pr:null,prRef:null};
      }else if(value==="差替取消"){
        next={...draft.data,replaceMediaId:undefined};
      }else if(draft.data.replaceMediaId){
        warning="⚠️ 差し替える画像・動画を送信してください。中止する場合は 差替取消 と送信してください。";
      }else if(ctx.message.text.length>10000){
        warning="⚠️ 自己PRは10000文字以内で送信してください。";
      }else{
        next={...draft.data,pr:ctx.message.text};
      }
      const updated=next===draft.data?draft:await repo.putDraft(ctx.from.id,"media",next,draft.revision);
      try{await ctx.deleteMessage();}catch{warning+="\\n⚠️ 入力を削除できませんでした。手動で削除してください。";}
      await updateWizardScreen(ctx,repo,updated,(warning?warning+"\\n\\n":"")+mediaText(updated.data),mediaKeyboard(updated.revision));
      return;
    }
    if(draft.step!=="awaiting_basic")return next();
    // Delete each user-sent input (valid or invalid) from the private chat.
    // Telegram may reject deletion (e.g. a message older than 48 hours).
    let removed = false;
    try { await ctx.deleteMessage(); removed = true; }
    catch { console.warn("[PROFILE_INPUT_DELETE_FAILED]"); }
    const deletionWarning = removed ? "" : "\n⚠️ 入力メッセージを削除できませんでした。手動で削除してください。";
    try {
      const basic = parseProfileBasic(ctx.message.text);
      const hasPosition = !!draft.data.position;
      const updated = await repo.putDraft(ctx.from.id,
        hasPosition ? "preview" : "awaiting_position", {...draft.data, ...basic}, draft.revision);
      if (hasPosition) {
        await updateWizardScreen(ctx, repo, updated,
          overviewText(updated.data as SavedProfile,ctx.from.username!) + deletionWarning,
          overviewKeyboard(updated.revision), "HTML");
      } else {
        await updateWizardScreen(ctx, repo, updated,
          "✅ 基本情報を受け付けました。\n下の7つのボタンからポジションを1つ選択してください。\n✅が現在の選択です。別の候補を押すと選び直せます。\n選択するとプロフィール一覧に進みます。" + deletionWarning,
          selectPosition(updated.revision,updated.data.position));
      }
    } catch (err) {
      if (err instanceof Error && ![
        "ニックネームと3数値を2行で入力してください",
        "ニックネームは40文字以内で入力してください",
        "2行目は",
        "身長は",
        "体重は",
        "年齢は",
      ].some(prefix => err.message.startsWith(prefix))) throw err;
      await updateWizardScreen(ctx, repo, draft,
        "⚠️ 入力を確認してください。\n" +
        (err instanceof Error ? err.message : "入力内容が正しくありません") +
        "\n\n入力例：ゼロ（1行目）／175 80 40（2行目）\n内容を修正して、もう一度テキストを送信してください。" + deletionWarning,
        selectPosition(draft.revision,draft.data.position));
    }
  });
  // Telegram holds the media bytes; only file_id and small metadata enter the draft.
  const receiveMedia=async(ctx:Context,next:()=>Promise<unknown>,kind:"photo"|"video")=>{
    if(ctx.chat?.type!=="private"||!ctx.from?.username)return next();
    if(await activeDmOwner(ctx.from.id)!=="profile")return next();
    const draft=await repo.getDraft(ctx.from.id);
    if(!draft||draft.step!=="media")return next();
    const message=ctx.message;
    if(!message)return next();
    const photo=kind==="photo"&&"photo" in message?message.photo.at(-1):undefined;
    const video=kind==="video"&&"video" in message?message.video:undefined;
    const fileId=photo?.file_id??video?.file_id;
    if(!fileId)return next();
    const entry:ProfileMediaItem={type:kind,fileId,sourceMessageId:message.message_id,
      ...("media_group_id" in message&&typeof message.media_group_id==="string"
        ?{mediaGroupId:message.media_group_id}:{})};
    const oldMedia=numberProfileMedia(draft.data.media);
    const nextId=Math.max(draft.data.mediaNextId??1,...oldMedia.map(item=>(item.itemId??0)+1),1);
    if(!Number.isSafeInteger(nextId))throw Error("PROFILE_MEDIA_ITEM_ID_OVERFLOW");
    const replacing=draft.data.replaceMediaId!==undefined;
    const items=replacing
      ?replaceProfileMedia(oldMedia,draft.data.replaceMediaId!,entry)
      :numberProfileMedia(appendProfileMedia(oldMedia,{...entry,itemId:nextId}));
    const updated=await repo.putDraft(ctx.from.id,"media",
      {...draft.data,media:items,mediaNextId:replacing?nextId:nextId+1,replaceMediaId:undefined},draft.revision);
    let warning="";
    try{await ctx.deleteMessage();}catch{warning="⚠️ 送信した媒体メッセージを削除できませんでした。手動で削除してください。\\n";}
    await updateWizardScreen(ctx,repo,updated,warning+mediaText(updated.data),mediaKeyboard(updated.revision));
    return;
  };
  bot.on("photo",async(ctx,next)=>receiveMedia(ctx,next,"photo"));
  bot.on("video",async(ctx,next)=>receiveMedia(ctx,next,"video"));

}
