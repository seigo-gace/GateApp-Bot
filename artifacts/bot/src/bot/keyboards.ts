import { Markup } from "telegraf";

// ─── request_chat keyboard (reply keyboard with native chat picker button) ───
// Returns a reply keyboard that triggers Telegram's chat selection UI
export function requestChatKeyboard(
  label: string,
  requestId: number,
  isChannel: boolean,
  isForum: boolean
) {
  const button: any = {
    text: `📋 ${label}を選ぶ`,
    request_chat: {
      request_id: requestId,
      chat_is_channel: isChannel,
      request_title: true,
      request_username: true,
      ...(isForum ? { chat_is_forum: true } : {}),
      // Require the user to have admin rights in the selected chat
      user_administrator_rights: {
        can_invite_users: true,
      },
    },
  };

  return {
    reply_markup: {
      keyboard: [[button]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

// Remove reply keyboard
export function removeKeyboard() {
  return Markup.removeKeyboard();
}

export function topMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("新しく追加", "menu:add")],
    [Markup.button.callback("管理中の一覧", "menu:list")],
    [Markup.button.callback("ブラックリスト", "menu:blacklist")],
  ]);
}

export function addMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("参加用グループ追加", "add:entry_group")],
    [Markup.button.callback("参加用チャンネル追加", "add:entry_channel")],
    [Markup.button.callback("ログ用グループ追加", "add:log_group")],
    [Markup.button.callback("戻る", "menu:top")],
  ]);
}

export function listMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("参加対象", "list:entry")],
    [Markup.button.callback("ロググループ", "list:log")],
    [Markup.button.callback("戻る", "menu:top")],
  ]);
}

export function targetDetailKeyboard(targetId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("基本情報", `target:info:${targetId}`)],
    [Markup.button.callback("ゲートリンク", `target:gate:${targetId}`)],
    [Markup.button.callback("Bot対策", `target:challenge:${targetId}`)],
    [Markup.button.callback("参加質問", `target:questions:${targetId}`)],
    [Markup.button.callback("ルール", `target:rules:${targetId}`)],
    [Markup.button.callback("参加条件プレビュー", `target:preview:${targetId}`)],
    [Markup.button.callback("ログ保存先", `target:logdest:${targetId}`)],
    [Markup.button.callback("管理者追加", `target:addadmin:${targetId}`)],
    [Markup.button.callback("削除", `target:delete:${targetId}`)],
    [Markup.button.callback("戻る", "list:entry")],
  ]);
}

export function logGroupDetailKeyboard(logGroupId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("基本情報", `lg:info:${logGroupId}`)],
    [Markup.button.callback("トピック管理", `lg:topics:${logGroupId}`)],
    [Markup.button.callback("使用中の対象", `lg:targets:${logGroupId}`)],
    [Markup.button.callback("管理者追加", `lg:addadmin:${logGroupId}`)],
    [Markup.button.callback("削除", `lg:delete:${logGroupId}`)],
    [Markup.button.callback("戻る", "list:log")],
  ]);
}

export function challengeSettingsKeyboard(
  targetId: number,
  enabled: boolean,
  difficulty: string,
  maxFail: number
) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        enabled ? "✅ ON" : "⬜ ON",
        `challenge:toggle:${targetId}:on`
      ),
      Markup.button.callback(
        !enabled ? "✅ OFF" : "⬜ OFF",
        `challenge:toggle:${targetId}:off`
      ),
    ],
    [
      Markup.button.callback(
        difficulty === "easy" ? "✅ 簡単" : "⬜ 簡単",
        `challenge:diff:${targetId}:easy`
      ),
      Markup.button.callback(
        difficulty === "standard" ? "✅ 標準" : "⬜ 標準",
        `challenge:diff:${targetId}:standard`
      ),
      Markup.button.callback(
        difficulty === "hard" ? "✅ 難しい" : "⬜ 難しい",
        `challenge:diff:${targetId}:hard`
      ),
    ],
    [
      Markup.button.callback(
        maxFail === 1 ? "✅ 1回" : "⬜ 1回",
        `challenge:fail:${targetId}:1`
      ),
      Markup.button.callback(
        maxFail === 3 ? "✅ 3回" : "⬜ 3回",
        `challenge:fail:${targetId}:3`
      ),
      Markup.button.callback(
        maxFail === 5 ? "✅ 5回" : "⬜ 5回",
        `challenge:fail:${targetId}:5`
      ),
    ],
    [Markup.button.callback("戻る", `target:detail:${targetId}`)],
  ]);
}

export function questionsMenuKeyboard(targetId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("質問1", `q:edit:${targetId}:1`)],
    [Markup.button.callback("質問2", `q:edit:${targetId}:2`)],
    [Markup.button.callback("質問3", `q:edit:${targetId}:3`)],
    [Markup.button.callback("戻る", `target:detail:${targetId}`)],
  ]);
}

export function questionEditKeyboard(
  targetId: number,
  orderIndex: number,
  enabled: boolean
) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        enabled ? "✅ 使用する" : "⬜ 使用する",
        `q:toggle:${targetId}:${orderIndex}:on`
      ),
      Markup.button.callback(
        !enabled ? "✅ 使用しない" : "⬜ 使用しない",
        `q:toggle:${targetId}:${orderIndex}:off`
      ),
    ],
    [Markup.button.callback("質問文を設定", `q:settext:${targetId}:${orderIndex}`)],
    [Markup.button.callback("選択肢を設定", `q:setoptions:${targetId}:${orderIndex}`)],
    [Markup.button.callback("正解ボタンを設定", `q:setcorrect:${targetId}:${orderIndex}`)],
    [Markup.button.callback("次へボタン文言", `q:setnext:${targetId}:${orderIndex}`)],
    [Markup.button.callback("戻る", `target:questions:${targetId}`)],
  ]);
}

export function ruleEditKeyboard(targetId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("ルール本文を設定", `rule:settext:${targetId}`)],
    [Markup.button.callback("承諾ボタン文言", `rule:setaccept:${targetId}`)],
    [Markup.button.callback("拒否ボタン文言", `rule:setreject:${targetId}`)],
    [Markup.button.callback("戻る", `target:detail:${targetId}`)],
  ]);
}

export function gateLinkKeyboard(targetId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("リンクを見る", `gate:view:${targetId}`)],
    [Markup.button.callback("リンクを作り直す", `gate:regen:${targetId}`)],
    [Markup.button.callback("戻る", `target:detail:${targetId}`)],
  ]);
}

export function logDestKeyboard(targetId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("ログ用グループを選ぶ", `logdest:choosegroup:${targetId}`)],
    [Markup.button.callback("トピックを選ぶ", `logdest:choosetopic:${targetId}`)],
    [Markup.button.callback("設定を確認", `logdest:confirm:${targetId}`)],
    [Markup.button.callback("戻る", `target:detail:${targetId}`)],
  ]);
}

export function addAdminKeyboard(entityId: number, entityType: "target" | "lg") {
  return Markup.inlineKeyboard([
    [Markup.button.callback("グループへ追加", `addadmin:group:${entityType}:${entityId}`)],
    [Markup.button.callback("チャンネルへ追加", `addadmin:channel:${entityType}:${entityId}`)],
    [Markup.button.callback("戻る", entityType === "target" ? `target:detail:${entityId}` : `lg:detail:${entityId}`)],
  ]);
}

export function topicManageKeyboard(logGroupId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("トピック一覧", `topic:list:${logGroupId}`)],
    [Markup.button.callback("トピック作成", `topic:create:${logGroupId}`)],
    [Markup.button.callback("トピック名変更", `topic:rename:${logGroupId}`)],
    [Markup.button.callback("戻る", `lg:detail:${logGroupId}`)],
  ]);
}

export function backToTargetKeyboard(targetId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("戻る", `target:detail:${targetId}`)],
  ]);
}

export function previewKeyboard(targetId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("ゲートテスト", `preview:test:${targetId}`)],
    [Markup.button.callback("戻る", `target:detail:${targetId}`)],
  ]);
}

export function blacklistMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("一覧を見る", "bl:list")],
    [Markup.button.callback("追加", "bl:add")],
    [Markup.button.callback("削除", "bl:remove")],
    [Markup.button.callback("戻る", "menu:top")],
  ]);
}
