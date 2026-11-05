import { Telegraf, Markup, type Context } from "telegraf";
import type { ProfileDraft, SavedProfile } from "../services/profileRepository.js";
import * as profileRepo from "../services/profileRepository.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {profileOverviewButtons} from "../services/profileOverviewLayout.js";
import {verifiedPostingMenuReturnUrl} from "../services/menuOriginRepository.js";
import {
  PROFILE_POSITIONS, parseProfileBasic, renderProfileBasicPreview,
} from "../services/profileCore.js";

type ProfileRepo = {
  getDraft: typeof profileRepo.getDraft;
  putDraft: typeof profileRepo.putDraft;
  getProfile: typeof profileRepo.getProfile;
  savePrivateDraft: typeof profileRepo.savePrivateDraft;
  discardDraft: typeof profileRepo.discardDraft;
  bindScreenMessage: typeof profileRepo.bindScreenMessage;
};

const selectPosition = (revision: number, selected?: string) => Markup.inlineKeyboard([
  ...[[0, 1, 2], [3, 4, 5, 6]].map(indices => indices.map(i =>
    Markup.button.callback((selected===PROFILE_POSITIONS[i]?"✅ ":"")+PROFILE_POSITIONS[i], `pf:pos:${revision}:${i}`))),
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
 if(existing){
  await ctx.reply(renderProfileBasicPreview(existing,ctx.from.username!),{
   parse_mode:"HTML",...Markup.inlineKeyboard([
    [Markup.button.callback("📝 基本情報を編集","pf:edit:basic")],
   ]),
  });
  return;
 }
 const previous = await repo.getDraft(ctx.from.id);
 const draft = await repo.putDraft(ctx.from.id,"awaiting_basic",{});
 const sent = await ctx.reply(basicPrompt(), selectPosition(draft.revision));
 await repo.bindScreenMessage(ctx.from.id, draft.revision, sent.message_id);
 if (previous?.data.screenMessageId && previous.data.screenMessageId !== sent.message_id) {
   try { await ctx.telegram.deleteMessage(ctx.chat.id, previous.data.screenMessageId); }
   catch { console.warn("[PROFILE_OLD_SCREEN_DELETE_FAILED]"); }
 }
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
    const position = PROFILE_POSITIONS[index];
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
      await ctx.answerCbQuery("非公開で保存しました");
      await ctx.editMessageText("✅ プロフィールを非公開保存しました。\n"+
        renderProfileBasicPreview(saved,ctx.from.username!),{parse_mode:"HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("📝 基本情報を編集","pf:edit:basic")]])});
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

  bot.action(/^pf:save:(\d+)$/, async (ctx) => {
    if (!canUseProfile(ctx)) return;
    const revision = Number(ctx.match[1]);
    const draft = await repo.getDraft(ctx.from.id);
    if (!draft || draft.revision !== revision || draft.step !== "preview") {
      await ctx.answerCbQuery("以前の保存ボタンです。プロフィールを開き直してください。");
      return;
    }
    const profile = await repo.savePrivateDraft(ctx.from.id, revision, ctx.from.username!);
    await ctx.answerCbQuery("非公開で保存しました");
    await ctx.editMessageText(
      "✅ 非公開プロフィールを保存しました。\nグループには投稿していません。\n"+
      renderProfileBasicPreview(profile, ctx.from.username!),
      {parse_mode:"HTML", ...Markup.inlineKeyboard([
        [Markup.button.callback("📝 基本情報を編集", "pf:edit:basic")],
      ])}
    );
  });

  // Register BEFORE the pre-existing admin message handler. All other
  // messages must continue through the established approval/admin route.
  bot.on("text", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !ctx.from?.username ||
        ctx.message.text.startsWith("/")) return next();
    if(await activeDmOwner(ctx.from.id)!=="profile")return next();
    const draft = await repo.getDraft(ctx.from.id);
    if (!draft || draft.step !== "awaiting_basic") return next();
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
}
