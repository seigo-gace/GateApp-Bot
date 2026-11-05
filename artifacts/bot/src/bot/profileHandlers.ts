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
};

const selectPosition = (revision: number) => Markup.inlineKeyboard(
  PROFILE_POSITIONS.map((p, i) => [Markup.button.callback(p, `pf:pos:${revision}:${i}`)])
);

const requestBasic = "🪪 プロフィールの基本情報（5項目必須）\nニックネームを1行目、身長 体重 年齢を半角スペース区切りで2行目に入力してください。\n例：ゼロ\n175 80 39\nポジションは次の5択から選びます。";

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
 await repo.putDraft(ctx.from.id,"awaiting_basic",{});
 await ctx.reply(requestBasic);
}

export function registerProfileHandlers(
  bot: Telegraf,
  repo: ProfileRepo = profileRepo,
): void {
  bot.command("profile", async ctx => startProfileEditor(ctx,repo));

  bot.action("pf:edit:basic", async (ctx) => {
    await ctx.answerCbQuery();
    if (!canUseProfile(ctx)) return;
    const existing = await repo.getProfile(ctx.from.id);
    if (!existing || existing.status !== "private") {
      await ctx.reply("公開済みのプロフィール編集は公開先の同期機能から行ってください。");
      return;
    }
    await repo.putDraft(ctx.from.id, "awaiting_basic", {
      nickname: existing.nickname,
      heightCm: existing.heightCm,
      weightKg: existing.weightKg,
      age: existing.age,
      position: existing.position,
    });
    await ctx.reply(requestBasic);
  });

  bot.action(/^pf:pos:(\d+):([0-4])$/, async (ctx) => {
    if (!canUseProfile(ctx)) return;
    const callbackRevision = Number(ctx.match[1]);
    const index = Number(ctx.match[2]);
    const draft = await repo.getDraft(ctx.from.id);
    if (!draft || draft.step !== "awaiting_position" ||
        draft.revision !== callbackRevision) {
      await ctx.answerCbQuery("前の操作です。プロフィールを開き直してください。");
      return;
    }
    const position = PROFILE_POSITIONS[index];
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
    if(await currentDmTextOwner(ctx.from.id)!=="profile")return next();
    const draft = await repo.getDraft(ctx.from.id);
    if (!draft || draft.step !== "awaiting_basic") return next();
    try {
      const basic = parseProfileBasic(ctx.message.text);
      const updated = await repo.putDraft(ctx.from.id,
        "awaiting_position", basic, draft.revision);
      await ctx.reply(
        "基本情報を受け付けました。ポジションを選択してください。",
        selectPosition(updated.revision)
      );
    } catch (err) {
      await ctx.reply(err instanceof Error ? err.message : "入力を確認してください");
    }
  });
}
