import { createHash } from "node:crypto";

/** TGtumbler adopted admission questions. Scope: @GayBBS_bot only.
 * Keep old 3-question storage for admin compatibility; admission uses exactly two
 * consent questions followed by the separately configured per-group rule consent.
 */
export const ADMISSION_VERSION = "2026-10-28-v1.0";
export const ADMISSION_STAGES = ["intro", "q1", "q2", "rules", "challenge", "approved", "rejected"] as const;
export type AdmissionStage = typeof ADMISSION_STAGES[number];
export type ConsentStage = "question1" | "question2" | "rules";
export const APPROVAL_DOC_KEYS = ["guideline", "terms", "privacy", "rules"] as const;
export type ApprovalDocKey = typeof APPROVAL_DOC_KEYS[number];
export const APPROVAL_QUESTIONS = [
  {
    stage: "q1", consent: "question1", title: "🌈 参加資格の確認",
    text: "こちらは男性同士の交流を目的としたゲイコミュニティです。\n\n参加対象は、18歳以上で、男性（FTMの方を含む）として男性との性的な関係を持てる方です。\n\n女性の方、参加条件に該当しない異性愛者の方、営業・勧誘・金銭目的で参加する方は対象外です。\n\nあなたはすべての参加条件を満たし、商用目的ではなく参加しますか？",
    yes: "✅ はい、参加条件を満たしています",
    no: "❌ いいえ、条件を満たしていません",
  },
  {
    stage: "q2", consent: "question2", title: "📜 規約・規則への承諾",
    text: "当コミュニティでは、皆さんが安心して交流できるよう、利用規約・禁止事項・プライバシーポリシーを定めています。\n\n参加前に、以下のリンクから規約・規則の全文をご確認ください。\n\n規約・規則の内容を確認し、すべて遵守することに同意しますか？",
    yes: "✅ はい、確認して同意します",
    no: "❌ いいえ、同意しません",
  },
] as const;
export const GROUP_RULES_INTRO =
  "このコミュニティには3つのグループがあり、それぞれ利用目的に応じたルールがあります。\n\n参加する前に、各グループのルールをご確認ください。";
export const GROUP_RULES_POLICY =
  "画像・動画のスポイラー、性的嗜好に関する過激な表現（NGワード）はそのまま使わず「変態」という言葉に置き換えること、URL直接投稿禁止、無許可販売・誘導禁止、スパム禁止、通常違反5段階、重大違反・虚偽申告の即時BANを理解してください。運営が正式に許可したCreators Video・Stars販売は、無許可の営業勧誘と混同しないでください。";
export const RULES_CONSENT_QUESTION =
  "3グループすべてのルールを確認し、遵守することに同意しますか？";
export const APPROVAL_SUMMARY =
  "① ガイドライン：安全と相互尊重\n" +
  "② 規約・参加条件：参加資格と利用責任\n" +
  "③ Privacy Policy：管理Botによる監視と違反履歴管理\n" +
  "④ グループルール：投稿・スポイラー・禁止行為";
export function isSafeDocUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === "https:" && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
}
export type AdmissionQuestionRecord = {order_index: number; enabled: boolean; question_text: string; button1_label: string; button2_label: string; correct_button: number};
export function hasAdoptedQuestions(rows: readonly AdmissionQuestionRecord[]): boolean {
  if (rows.length !== 3) return false;
  return APPROVAL_QUESTIONS.every((q, i) => {
    const r = rows.find(x => x.order_index === i + 1);
    return !!r && r.enabled && r.question_text === q.text &&
      r.button1_label === q.yes && r.button2_label === q.no && r.correct_button === 1;
  }) && rows.some(r => r.order_index === 3 && !r.enabled);
}
export function acceptedStagesComplete(stages: readonly string[]): boolean {
  return ["question1", "question2", "rules"].every(s => stages.includes(s));
}

/**
 * Defense in depth for the two adopted questions and separate group-rule consent.
 * A state change alone must never issue an invitation or mint consent receipts.
 */
export function canAdvanceAdmission(
 from: string, next: string,
 consent?: {stage: ConsentStage; accepted: boolean},
): boolean {
 if (from === "intro") return next === "q1" && consent === undefined;
 if (from === "challenge") {
  return (next === "challenge" || next === "issuing" || next === "rejected") &&
   consent === undefined;
 }
 const required: ConsentStage | undefined =
  from === "q1" ? "question1" :
  from === "q2" ? "question2" :
  from === "rules" ? "rules" : undefined;
 if (!required || consent?.stage !== required) return false;
 const forward = from === "q1" ? "q2" : from === "q2" ? "rules" : "challenge";
 return (next === forward && consent.accepted === true) ||
  (next === "rejected" && consent.accepted === false);
}

/** Bind each consent attempt to the actual fixed questions, links, ordered flow and group rules.
 * Any change requires a fresh attempt, even if the human-readable base version
 * was not manually incremented. No raw document or user data leaves the module.
 */
export function admissionDocumentVersion(
 targetId: number, rulesText: string, links: Readonly<Record<ApprovalDocKey, string>>,
): string {
 if (!Number.isSafeInteger(targetId) || targetId <= 0 || !rulesText.trim() ||
  !APPROVAL_DOC_KEYS.every(key => isSafeDocUrl(links[key]))) {
  throw new Error("GATE_DOCUMENT_VERSION_UNSAFE");
 }
 const digest = createHash("sha256").update(JSON.stringify([
  ADMISSION_VERSION,ADMISSION_STAGES,targetId,APPROVAL_QUESTIONS,
  GROUP_RULES_INTRO,GROUP_RULES_POLICY,RULES_CONSENT_QUESTION,
  rulesText,...APPROVAL_DOC_KEYS.map(key => [key,links[key]]),
 ])).digest("hex");
 return ADMISSION_VERSION + ":" + digest;
}

/** Three adopted TGtumbler boards; live Bot membership/IDs must be verified
 * separately before deployment. No other legacy groups can enter admission.
 */
export const ADMISSION_BOARD_CHAT_IDS = [
 -1003847210571, // エリア's BBS
 -1002373696859, // ビデオChat
 -1003770334893, // ゲイのための掲示板
] as const;
export type SharedAdmissionBoard = {
 targetId:number; chatId:number; title:string; rulesText:string;
 links:Readonly<Record<ApprovalDocKey,string>>;
};

/** One consent revision covering the complete, ordered set of 3 boards. */
export function sharedAdmissionDocumentVersion(boards:readonly SharedAdmissionBoard[]):string {
 if(boards.length!==ADMISSION_BOARD_CHAT_IDS.length)throw new Error("GATE_THREE_BOARDS_REQUIRED");
 const versions=ADMISSION_BOARD_CHAT_IDS.map(chatId=>{
  const matches=boards.filter(b=>b.chatId===chatId);
  if(matches.length!==1||!matches[0]!.title.trim())throw new Error("GATE_BOARD_MAP_INVALID");
  const b=matches[0]!;
  return [chatId,b.title,admissionDocumentVersion(b.targetId,b.rulesText,b.links)];
 });
 return ADMISSION_VERSION+":"+createHash("sha256").update(JSON.stringify(versions)).digest("hex");
}

/** Global admission is all-or-nothing, never one entitlement per board.
 * Rejected, missing or duplicated board status blocks ALL three joins.
 */
export function allThreeBoardsApproved(
 rows:readonly {chat_id:string|number;status:string}[],
):boolean {
 return rows.length===ADMISSION_BOARD_CHAT_IDS.length &&
  ADMISSION_BOARD_CHAT_IDS.every(chatId=>
   rows.filter(row=>Number(row.chat_id)===chatId && row.status==="approved").length===1);
}
