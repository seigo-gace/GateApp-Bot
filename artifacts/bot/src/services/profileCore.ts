/** TGtumbler A05 profile basic fields. Adopted Notion profile spec.
 * Adopted latest spec: nickname is mandatory; three numbers share line 2.
 * Saving a profile never publishes it to a group.
 */
export const PROFILE_POSITIONS = ["タチ", "タチリバ", "リバ", "ウケリバ", "ウケ", "S", "M"] as const;
export type ProfilePosition = typeof PROFILE_POSITIONS[number];
export type ProfileBasic = {
  nickname: string;
  heightCm: number;
  weightKg: number;
  age: number;
};
export type ProfileBasicDraft = ProfileBasic & {position?: ProfilePosition};
/** Values outside these 50-unit bands are treated as likely input mistakes,
 * not as claims about physical impossibility.
 * The 18-year minimum below is for form validation; group admission rules
 * remain a separate policy and must be checked before public participation.
 */
export const PROFILE_INPUT_LIMITS = {
  heightCm: {min: 100, max: 250},
  weightKg: {min: 50, max: 250},
  age: {min: 18, max: 89},
} as const;

export function parseProfileBasic(text: string): ProfileBasic {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].trim()) {
    throw new Error("ニックネームと3数値を2行で入力してください。例：ゼロ\n175 80 39");
  }
  const nickname = lines[0].trim();
  if (nickname.length > 40) throw new Error("ニックネームは40文字以内で入力してください");
  // The same separator must divide exactly three integer values.
  // Accept the agreed forms: space, slash, hash, or hyphen; no mixed separators.
  const numbers = lines[1].trim();
  const match = numbers.match(/^(\d{2,3})([ \/#-])(\d{2,3})\2(\d{1,3})$/);
  if (!match) {
    throw new Error("2行目は「175 80 40」「175/80/40」「175#80#40」「175-80-40」の形式で再入力してください");
  }
  const heightCm = Number(match[1]);
  const weightKg = Number(match[3]);
  const age = Number(match[4]);
  if (heightCm < PROFILE_INPUT_LIMITS.heightCm.min ||
      heightCm > PROFILE_INPUT_LIMITS.heightCm.max) {
    throw new Error("身長は100〜250cmで入力してください");
  }
  if (weightKg < PROFILE_INPUT_LIMITS.weightKg.min ||
      weightKg > PROFILE_INPUT_LIMITS.weightKg.max) {
    throw new Error("体重は50〜250kgで入力してください");
  }
  if (age < PROFILE_INPUT_LIMITS.age.min || age > PROFILE_INPUT_LIMITS.age.max) {
    throw new Error("年齢は18〜89歳で入力してください");
  }
  return {nickname,heightCm,weightKg,age};
}
export function isProfilePosition(v: string): v is ProfilePosition {
  return PROFILE_POSITIONS.some(p => p === v);
}
export function escapeProfileHtml(v: string): string {
  return v.replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
export type ProfileDisplayExtras = {
 hair?:string|null;body?:string|null;region?:string|null;area?:string|null;
 pr?:string|null;likeTags?:readonly {category:string;tag:string}[];
 loveTags?:readonly {category:string;tag:string}[];
 media?:readonly {type:string;fileId:string}[];
};
/** Fixed-profile card body. Show headings with blank values, never "未登録".
 * Only the first three tags of each purpose appear on the card; detailed
 * viewing and Telegram media reveal are separate, explicitly selected flows.
 */
function displayProfileLines(p:ProfileBasicDraft & ProfileDisplayExtras,displayName:string):string[]{
 const compact=(v:string|null|undefined)=>escapeProfileHtml(v??"");
 const tags=(v:readonly {category:string;tag:string}[]|undefined)=>
  (v??[]).slice(0,3).map(x=>"#"+compact(x.tag)).join(" ");
 const pr=p.pr?.trim().replace(/\s+/g," ").slice(0,180)??"";
 return [
  "🪪 "+displayName,
  p.heightCm+"cm | "+p.weightKg+"kg | "+p.age+"歳 | "+compact(p.position||"未選択"),
  "髪型："+compact(p.hair)+" | 体型："+compact(p.body),
  "✈️ エリア："+(p.region&&p.area?compact(p.region)+" ＞ "+compact(p.area):""),
  "💖 #Like | "+tags(p.likeTags),
  "💘 #Love | "+tags(p.loveTags),
  "PR："+compact(pr),
 ];
}
export function renderProfileBasicPreview(
 p:ProfileBasicDraft & ProfileDisplayExtras,username:string,
):string{
 if(!/^[A-Za-z0-9_]{5,32}$/.test(username))throw new Error("Telegram usernameが必要です");
 const label=p.nickname?.trim()||"@"+username;
 const who='<a href="https://t.me/'+username+'">'+escapeProfileHtml(label)+'</a>';
 return displayProfileLines(p,who).join("\n");
}

/** Public card is derived from the approved saved original. It contains no
 * automatic account handle or raw Telegram media. Any public exposure must
 * first pass the verified Topic + explicit consent release gate.
 */
export function renderPublicProfile(p:ProfileBasicDraft & ProfileDisplayExtras):string{
 if(!p.nickname?.trim()||!p.position||!isProfilePosition(p.position))
  throw new Error("PROFILE_INCOMPLETE");
 return displayProfileLines(p,escapeProfileHtml(p.nickname.trim())).join("\n");
}
