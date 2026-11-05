import { Telegraf, Markup, type Context } from "telegraf";
import type { ProfileDraft, SavedProfile } from "../services/profileRepository.js";
import * as profileRepo from "../services/profileRepository.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {
  PROFILE_POSITIONS, parseProfileBasic, renderProfileBasicPreview,
} from "../services/profileCore.js";

type ProfileRepo = {
  getDraft: typeof profileRepo.getDraft;
  putDraft: typeof profileRepo.putDraft;
  getProfile: typeof profileRepo.getProfile;
  savePrivateDraft: typeof profileRepo.savePrivateDraft;
  discardDraft: typeof profileRepo.discardDraft;
};

const selectPosition = (revision: number) => Markup.inlineKeyboard([
  ...[[0, 1, 2], [3, 4, 5, 6]].map(indices => indices.map(i =>
    Markup.button.callback(PROFILE_POSITIONS[i], `pf:pos:${revision}:${i}`))),
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

function basicPrompt(position?: string): string {
  return requestBasic + (position ? "\n\n✅ 選択中：" + position + "（基本情報も送信してください）" : "");
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
 const draft = await repo.putDraft(ctx.from.id,"awaiting_basic",{});
 await ctx.reply(basicPrompt(), selectPosition(draft.revision));
}

export function registerProfileHandlers(
  bot: Telegraf,
  repo: ProfileRepo = profileRepo,
  activeDmOwner:typeof currentDmTextOwner=currentDmTextOwner,
): void {
  bot.command("profile", async ctx => startProfileEditor(ctx,repo));

  bot.action(/^pf:cancel:(\d+)$/, async (ctx) => {
    if (!canUseProfile(ctx)) return;
    const revision = Number(ctx.match[1]);
    const cancelled = await repo.discardDraft(ctx.from.id, revision);
    if (!cancelled) {
      await ctx.answerCbQuery("古い画面です。最新の画面から操作してください。");
      return;
    }
    await ctx.answerCbQuery("キャンセルしました");
    const existing = await repo.getProfile(ctx.from.id);
    if (existing) {
      await ctx.editMessageText(renderProfileBasicPreview(existing, ctx.from.username!), {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("📝 基本情報を編集", "pf:edit:basic")]]),
      });
      return;
    }
    await ctx.editMessageText("🪪 プロフィールの入力をキャンセルしました。", 
      Markup.inlineKeyboard([[Markup.button.callback("🪪 プロフ作成", "pf:restart")]]));
  });

  bot.action("pf:restart", async (ctx) => {
    if (!canUseProfile(ctx)) return;
    await ctx.answerCbQuery();
    await startProfileEditor(ctx, repo);
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
      nickname: existing.nickname,
      heightCm: existing.heightCm,
      weightKg: existing.weightKg,
      age: existing.age,
      position: existing.position,
    });
    await ctx.reply(basicPrompt(existing.position), selectPosition(draft.revision));
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
    if (draft.step === "awaiting_basic") {
      const updated = await repo.putDraft(ctx.from.id, "awaiting_basic",
        {...draft.data, position}, draft.revision);
      await ctx.answerCbQuery("ポジションを選択しました");
      await ctx.editMessageText(basicPrompt(position), selectPosition(updated.revision));
      return;
    }
    const updated = await repo.putDraft(ctx.from.id, "preview",
      {...draft.data, position}, draft.revision);
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      "🪪 プレビュー（まだ非公開）\n"+renderProfileBasicPreview(
        updated.data as SavedProfile, ctx.from.username!),
      {parse_mode:"HTML", ...Markup.inlineKeyboard([
        [Markup.button.callback("💾 非公開で保存", `pf:save:${updated.revision}`)],
        [Markup.button.callback("📝 基本情報を修正", "pf:edit:basic")],
      ])}
    );
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
    try {
      const basic = parseProfileBasic(ctx.message.text);
      const hasPosition = !!draft.data.position;
      const updated = await repo.putDraft(ctx.from.id,
        hasPosition ? "preview" : "awaiting_position", {...draft.data, ...basic}, draft.revision);
      if (hasPosition) {
        await ctx.reply("🪪 プレビュー（まだ非公開）\n"+renderProfileBasicPreview(
          updated.data as SavedProfile, ctx.from.username!), {
          parse_mode:"HTML", ...Markup.inlineKeyboard([
            [Markup.button.callback("💾 非公開で保存", `pf:save:${updated.revision}`)],
            [Markup.button.callback("📝 基本情報を修正", "pf:edit:basic")],
          ]),
        });
      } else {
        await ctx.reply("✅ 基本情報を受け付けました。ポジションを選択してください。",
          selectPosition(updated.revision));
      }
    } catch (err) {
      await ctx.reply("⚠️ 入力を確認してください。\n"+
        (err instanceof Error ? err.message : "入力内容が正しくありません")+
        "\n\n内容を修正して、もう一度テキストを送信してください。", selectPosition(draft.revision));
    }
  });
}
