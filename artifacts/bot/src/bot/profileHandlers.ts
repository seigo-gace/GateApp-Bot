import { Telegraf, Markup, type Context } from "telegraf";
import type { ProfileDraft, SavedProfile } from "../services/profileRepository.js";
import * as profileRepo from "../services/profileRepository.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {profileOverviewButtons} from "../services/profileOverviewLayout.js";
import {nextSelection,selectionRows} from "../services/inlineSelection.js";
import {HAIR_CHOICES,BODY_CHOICES,HAIR_ROWS,BODY_ROWS} from "../services/profileAppearance.js";
import {PROFILE_AREA_BLOCKS,areaChildren,areaButtonRows,toggleProfileArea,isAreaBlock,type ProfileAreaBlock} from "../services/profileArea.js";
import {verifiedPostingMenuReturnUrl} from "../services/menuOriginRepository.js";
import {appendProfileMedia,mediaStatus,type ProfileMediaItem} from "../services/profileMedia.js";
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
const appearanceKeyboard=(revision:number)=>Markup.inlineKeyboard([[
  Markup.button.callback("髪型",`pf:ap:${revision}:open:h`),
  Markup.button.callback("体型",`pf:ap:${revision}:open:b`),
  Markup.button.callback("エリア",`pf:ap:${revision}:area`),
  Markup.button.callback("戻る",`pf:ap:${revision}:back`),
]]);
const appearanceText=(data:ProfileDraft["data"])=>[
  "🪪 プロフィール｜容姿/エリア",
  "髪型："+(data.hair||"未設定"),
  "体型："+(data.body||"未設定"),
  "エリア："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
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
 ]);
};
const choiceText=(kind:"h"|"b",data:ProfileDraft["data"])=>
  [
    kind==="h"?"💈 髪型を選択してください":"💪 体型を選択してください",
    "現在："+(kind==="h"?(data.hair||"未設定"):(data.body||"未設定")),
    "1つ選択。同じ候補を押すと解除できます。",
  ].join("\n");

/** Region IDs are independent of any Telegram topic IDs or deep links. */
const areaBlocksKeyboard=(revision:number,data:ProfileDraft["data"])=>{
 const rows=areaButtonRows(PROFILE_AREA_BLOCKS,"↩ 戻る");
 return Markup.inlineKeyboard(rows.map(row=>row.map(label=>{
  if(label==="↩ 戻る")return Markup.button.callback(label,`pf:ar:${revision}:back`);
  const index=PROFILE_AREA_BLOCKS.indexOf(label as ProfileAreaBlock);
  const checked=data.region===label&&data.area!=null;
  return Markup.button.callback((checked?"✅ ":"▫️ ")+label,
   `pf:ar:${revision}:r:${index}`);
 })));
};
const areaBlocksText=(data:ProfileDraft["data"])=>[
 "📍 エリアを選択してください",
 "現在："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
 "13ブロックから選択。北海道・沖縄は直接選択されます。",
].join("\n");
const areaChildrenKeyboard=(revision:number,data:ProfileDraft["data"])=>{
 const block=data.pendingRegion;
 if(!block)throw Error("PROFILE_AREA_BLOCK_MISSING");
 const options=areaChildren(block);
 return Markup.inlineKeyboard(areaButtonRows(options).map(row=>row.map(label=>{
  if(label==="↩ 戻る")return Markup.button.callback(label,`pf:ar:${revision}:back`);
  const index=options.indexOf(label);
  return Markup.button.callback((data.region===block&&data.area===label?"✅ ":"▫️ ")+label,
   `pf:ar:${revision}:a:${index}`);
 })));
};
const areaChildrenText=(data:ProfileDraft["data"])=>[
 "📍 "+data.pendingRegion+"｜エリアを選択",
 "現在："+(data.region&&data.area?data.region+" ＞ "+data.area:"未設定"),
 "同じエリアを再度押すと未設定に戻せます。",
].join("\n");

const mediaKeyboard=(rev:number)=>Markup.inlineKeyboard([[Markup.button.callback("↩ 戻る",`pf:media:${rev}:back`)]]);
const mediaText=(data:ProfileDraft["data"])=>[
 "🪪 プロフィール｜画像・動画・自己PR",
 "画像・動画はTelegramの添付から送信してください。",
 "自己PRは通常の入力欄から文章で送信してください。",
 "どちらも任意で、文章は新しい入力で更新します。",
 "",
 ...mediaStatus(data.media,data.pr),
].join("\n");
const overviewText=(profile:SavedProfile,username:string)=>[
  "🪪 プロフィールプレビュー",
  renderProfileBasicPreview(profile,username),
  "",
  "ほかにも任意で登録できる項目があります。",
  "登録したい項目を下のボタンから選んでください。",
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
   const text=previous.step==="media"?mediaText(previous.data)
     :previous.step==="area-blocks"?areaBlocksText(previous.data)
     :previous.step==="area-children"?areaChildrenText(previous.data)
     :previous.step==="hair"||previous.step==="body"
     ?choiceText(previous.step==="hair"?"h":"b",previous.data)
     :previous.step==="appearance"
       ?appearanceText(previous.data)
     :previous.step==="preview"
     ? overviewText(previous.data as SavedProfile,ctx.from.username!)
     :previous.step==="awaiting_position"
       ?"✅ 基本情報を受け付けました。ポジションを選択してください。"
       :basicPrompt(previous.data.position);
   const markup=previous.step==="media"?mediaKeyboard(previous.revision)
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
   if(existing.status==="private"){
     const draft=await repo.putDraft(ctx.from.id,"preview",{
       nickname:existing.nickname,heightCm:existing.heightCm,
       weightKg:existing.weightKg,age:existing.age,position:existing.position,
       hair:existing.hair,body:existing.body,region:existing.region,area:existing.area,
       pr:existing.pr,media:existing.media,
       ...(lastId?{screenMessageId:lastId}:{}),
     });
     await updateWizardScreen(ctx,repo,draft,
       overviewText(existing,ctx.from.username!),
       overviewKeyboard(draft.revision),"HTML");
     return;
   }
   // A published original must not be silently made editable without synchronizing posts.
   await ctx.reply(renderProfileBasicPreview(existing,ctx.from.username!),{
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
  getPostingMenuUrl:typeof verifiedPostingMenuReturnUrl=verifiedPostingMenuReturnUrl,
): void {
  bot.command("profile", async ctx => startProfileEditor(ctx,repo));

  /** Editing one Bot-owned screen, never a synthetic posting-menu URL. */
  const returnToPostingMenu=async(ctx:Context):Promise<void>=>{
    if(!ctx.from)return;
    let url:string|null=null;
    try { url=await getPostingMenuUrl(ctx.from.id); }
    catch { console.warn("[PROFILE_POSTING_MENU_LOOKUP_FAILED]"); }
    if(url){
      await ctx.editMessageText("📝 投稿メニューへ戻ります。グループの固定メニューを開いてください。",
        Markup.inlineKeyboard([[Markup.button.url("↩ 投稿メニューに戻る",url)]]));
    }else{
      await ctx.editMessageText(
        "📝 投稿メニューに戻るには、元のグループの固定投稿メニューを開いてください。\n"+
        "このチャットの起点メニューが確認できないため、リンクは表示していません。");
    }
  };

  bot.action(/^pf:cancel:(\d+)$/, async (ctx) => {
    if (!canUseProfile(ctx)) return;
    const revision = Number(ctx.match[1]);
    const cancelled = await repo.discardDraft(ctx.from.id, revision);
    if (!cancelled) {
      await ctx.answerCbQuery("古い画面です。最新の画面から操作してください。");
      return;
    }
    await ctx.answerCbQuery("キャンセルしました");
    await returnToPostingMenu(ctx);
  });

  bot.action("pf:restart", async (ctx) => {
    if (!canUseProfile(ctx)) return;
    const existing = await repo.getProfile(ctx.from.id);
    if (existing) {
      await ctx.answerCbQuery("保存済みプロフィールがあります");
      await ctx.editMessageText(renderProfileBasicPreview(existing, ctx.from.username!), {
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
    if (!existing || existing.status !== "private") {
      await ctx.reply("公開済みのプロフィール編集は公開先の同期機能から行ってください。");
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
      pr:existing.pr,media:existing.media,
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
    if(action==="preview"){
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        "🪪 プロフィール公開前プレビュー（まだ非公開）\n"+
        renderProfileBasicPreview(draft.data as SavedProfile,ctx.from.username!)+
        "\n\nこれは確認画面です。保存だけでは公開されません。",
        {parse_mode:"HTML",...Markup.inlineKeyboard([
          [Markup.button.callback("↩ プロフィール編集に戻る",
            "pf:overview:"+draft.revision+":return")]
        ])});
      return;
    }
    if(action==="save"){
      const saved=await repo.savePrivateDraft(ctx.from.id,draft.revision,ctx.from.username!);
      // New revision invalidates pre-save callbacks while preserving this screen.
      const next=await repo.putDraft(ctx.from.id,"preview",{
        nickname:saved.nickname,heightCm:saved.heightCm,weightKg:saved.weightKg,
        age:saved.age,position:saved.position,hair:saved.hair,body:saved.body,
        region:saved.region,area:saved.area,pr:saved.pr,media:saved.media,
        screenMessageId:draft.data.screenMessageId,
      });
      await ctx.answerCbQuery("非公開で保存しました");
      await ctx.editMessageText("✅ 非公開保存しました。グループには投稿していません。\n"+
        overviewText(saved,ctx.from.username!),{parse_mode:"HTML",...overviewKeyboard(next.revision)});
      return;
    }
    if(action==="cancel"){
      const cancelled=await repo.discardDraft(ctx.from.id,draft.revision);
      if(!cancelled){await ctx.answerCbQuery("古い操作です");return;}
      await ctx.answerCbQuery("キャンセルしました");
      await returnToPostingMenu(ctx);
      return;
    }
    await ctx.answerCbQuery("この項目の設定画面は次に実装します。");
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
    const saved=await repo.savePrivateDraft(ctx.from.id,rev,ctx.from.username!);
    const next=await repo.putDraft(ctx.from.id,"preview",{
      nickname:saved.nickname,heightCm:saved.heightCm,weightKg:saved.weightKg,
      age:saved.age,position:saved.position,hair:saved.hair,body:saved.body,
      region:saved.region,area:saved.area,pr:saved.pr,media:saved.media,screenMessageId:draft.data.screenMessageId,
    });
    await ctx.answerCbQuery("非公開で保存しました");
    await ctx.editMessageText("✅ 非公開保存しました。グループには投稿していません。\n"+
      overviewText(saved,ctx.from.username!),{parse_mode:"HTML",...overviewKeyboard(next.revision)});
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
      const value=ctx.message.text;
      if(value.length>10000){
        await updateWizardScreen(ctx,repo,draft,"⚠️ 自己PRは10000文字以内で送信してください。",mediaKeyboard(draft.revision));
        return;
      }
      const updated=await repo.putDraft(ctx.from.id,"media",{...draft.data,pr:value},draft.revision);
      try{await ctx.deleteMessage();}catch{console.warn("[PROFILE_PR_DELETE_FAILED]");}
      await updateWizardScreen(ctx,repo,updated,mediaText(updated.data),mediaKeyboard(updated.revision));
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
          "✅ 基本情報を受け付けました。ポジションを選択してください。" + deletionWarning,
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
        "\n\n内容を修正して、もう一度テキストを送信してください。" + deletionWarning,
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
    const items=appendProfileMedia(draft.data.media,entry);
    if(items.length>100){
      await updateWizardScreen(ctx,repo,draft,"⚠️ 登録数上限です。"+mediaText(draft.data),mediaKeyboard(draft.revision));
      return;
    }
    const updated=await repo.putDraft(ctx.from.id,"media",{...draft.data,media:items},draft.revision);
    try{await ctx.deleteMessage();}catch{console.warn("[PROFILE_MEDIA_DELETE_FAILED]");}
    await updateWizardScreen(ctx,repo,updated,mediaText(updated.data),mediaKeyboard(updated.revision));
  };
  bot.on("photo",async(ctx,next)=>receiveMedia(ctx,next,"photo"));
  bot.on("video",async(ctx,next)=>receiveMedia(ctx,next,"video"));

}
