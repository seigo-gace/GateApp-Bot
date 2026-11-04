/** TGtumbler A05 profile basic fields. Adopted Notion profile spec.
 * Nickname is optional; the three numbers share one line.
 * Saving a profile never publishes it to a group.
 */
export const PROFILE_POSITIONS = ["タチ", "タチリバ", "リバ", "ウケリバ", "ウケ"] as const;
export type ProfilePosition = typeof PROFILE_POSITIONS[number];
export type ProfileBasic = {
  nickname: string | null;
  heightCm: number;
  weightKg: number;
  age: number;
};
export type ProfileBasicDraft = ProfileBasic & {position?: ProfilePosition};
export function parseProfileBasic(text: string): ProfileBasic {
  const lines = text.trim().split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 2) throw new Error("名前は任意、数値は1行で入力してください");
  if (lines.length !== 2 || !lines[0]) throw new Error("ニックネームと3数値の2行入力が必須です");
  const nickname = lines[0];
  if (nickname && nickname.length > 40) throw new Error("ニックネームは40文字以内です");
  const m = lines[lines.length - 1].match(/^(\d{2,3}) (\d{2,3}) (\d{2,3})$/);
  if (!m) throw new Error("身長 体重 年齢を半角スペースで区切って入力してください。例：175 80 39");
  const [heightCm,weightKg,age] = m.slice(1).map(Number);
  if (heightCm < 90 || heightCm > 250 || weightKg < 25 || weightKg > 300 ||
      age < 20 || age > 120) throw new Error("数値を確認してください");
  return {nickname, heightCm, weightKg, age};
}
export function isProfilePosition(v: string): v is ProfilePosition {
  return PROFILE_POSITIONS.some(p => p === v);
}
export function escapeProfileHtml(v: string): string {
  return v.replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
export function renderProfileBasicPreview(p: ProfileBasicDraft, username: string): string {
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) throw new Error("Telegram usernameが必要です");
  const label = p.nickname?.trim() || "@"+username;
  const who = '<a href="https://t.me/'+username+'">'+escapeProfileHtml(label)+'</a>';
  return [
    "🪪 "+who,
    p.heightCm+"cm | "+p.weightKg+"kg | "+p.age+"歳 | "+(p.position || "未選択"),
    "髪型： | 体型：",
    "✈️ エリア：",
    "💖 #Like | ",
    "💘 #Love | ",
    "PR：",
  ].join("\n");
}

/** Public profile contains only explicitly collected profile fields.
 * Telegram username and account URL are NEVER added automatically.
 */
export function renderPublicProfile(p: ProfileBasicDraft): string {
  if (!p.nickname?.trim() || !p.position || !isProfilePosition(p.position)) throw new Error("PROFILE_INCOMPLETE");
  return [
    "🪪 " + escapeProfileHtml(p.nickname?.trim() || "匿名ユーザー"),
    p.heightCm + "cm | " + p.weightKg + "kg | " + p.age + "歳 | " + escapeProfileHtml(p.position),
  ].join("\n");
}
