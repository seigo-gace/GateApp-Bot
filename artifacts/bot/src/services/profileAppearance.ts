/** Approved ② appearance choices, exact original notation from adopted option sheet.
 * Area uses a separate catalog and is deliberately not implemented here.
 */
export const HAIR_CHOICES = [
  "坊主","短髪","ソフモヒ","ベリーショート","ショート",
  "普通","刈り上げ","パーマ","ミディアム","ロング",
] as const;
export const BODY_CHOICES = [
  "チビ","ガッチビ","細身","細マッチョ","普通",
  "筋肉質","マッチョ","ガッチリ","ガチムチ","ガチポ",
  "ムッチリ","ぽっちゃり","デブ",
] as const;
export type HairChoice=typeof HAIR_CHOICES[number];
export type BodyChoice=typeof BODY_CHOICES[number];
export type AppearanceValues={hair?:HairChoice|null;body?:BodyChoice|null};
export function validateAppearance(v:AppearanceValues):void{
 if(v.hair!=null&&!HAIR_CHOICES.includes(v.hair))throw new Error("PROFILE_HAIR_INVALID");
 if(v.body!=null&&!BODY_CHOICES.includes(v.body))throw new Error("PROFILE_BODY_INVALID");
}
/** Compact full-screen rows, no empty cells or inert filler buttons. */
export const HAIR_ROWS=[
  [...HAIR_CHOICES.slice(0,3)],[...HAIR_CHOICES.slice(3,6)],
  [...HAIR_CHOICES.slice(6,9)],[HAIR_CHOICES[9]],
] as const;
export const BODY_ROWS=[
  [...BODY_CHOICES.slice(0,3)],[...BODY_CHOICES.slice(3,6)],
  [...BODY_CHOICES.slice(6,9)],[...BODY_CHOICES.slice(9,12)],
  [BODY_CHOICES[12]],
] as const;
