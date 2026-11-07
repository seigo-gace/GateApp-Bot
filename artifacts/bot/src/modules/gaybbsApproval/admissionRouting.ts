/** Gate entry routing: unapproved / approved+not joined / joined — reuse existing approval data. */
import type { Telegram } from "telegraf";
import { Markup } from "telegraf";
import { pool } from "../../db/index.js";
import { ADMISSION_BOARD_CHAT_IDS, allThreeBoardsApproved } from "./contract.js";
import {
  currentIssuedInvites,
  readAttempt,
  rememberScreen,
  withAdmissionClient,
  type GateAttempt,
} from "./store.js";
import { showWizardScreen } from "../../services/dmWizardScreen.js";

export type BoardTarget = { targetId: number; chatId: number; title: string };
export type GateEntryKind = "blocked" | "fresh" | "approved_join" | "member_direct";

export type GateEntryRoute = {
  kind: GateEntryKind;
  attempt?: GateAttempt;
  joined: number[];
  pending: number[];
};

const JOINED = new Set(["creator", "administrator", "member", "restricted"]);

export function groupDeepLink(chatId: number): string {
  const tail = String(chatId).replace(/^-100/, "");
  return `https://t.me/c/${tail}/1`;
}

export async function membershipForBoards(
  telegram: Telegram,
  userId: number,
  boards: readonly BoardTarget[],
): Promise<{ joined: number[]; pending: number[] }> {
  const joined: number[] = [];
  const pending: number[] = [];
  for (const b of boards) {
    try {
      const m = await telegram.getChatMember(b.chatId, userId);
      if (JOINED.has(m.status)) joined.push(b.chatId);
      else pending.push(b.chatId);
    } catch {
      pending.push(b.chatId);
    }
  }
  return { joined, pending };
}

async function latestSharedApproval(
  userId: number,
  documentVersion: string,
): Promise<GateAttempt | undefined> {
  const session = await readAttempt(userId);
  if (
    session?.step === "approved" &&
    session.document_version === documentVersion
  ) {
    const ok = await withAdmissionClient(async (c) => {
      const rows = await c.query<{ chat_id: string; status: string }>(
        `SELECT t.chat_id,a.status FROM approvals a
         JOIN targets t ON t.target_id=a.target_id
         WHERE a.tg_user_id=$1 AND a.attempt_id=$2 AND a.document_version=$3
           AND t.target_type='entry_group' AND t.chat_id=ANY($4::bigint[])`,
        [userId, session.attempt_id, documentVersion, [...ADMISSION_BOARD_CHAT_IDS]],
      );
      return allThreeBoardsApproved(rows.rows);
    });
    if (ok) return session;
  }
  const r = await pool.query<GateAttempt>(
    `SELECT s.* FROM gate_sessions s
     WHERE s.tg_user_id=$1 AND s.step='approved' AND s.document_version=$2
     ORDER BY s.updated_at DESC LIMIT 1`,
    [userId, documentVersion],
  );
  if (r.rowCount !== 1) return undefined;
  const attempt = r.rows[0]!;
  const ok = await withAdmissionClient(async (c) => {
    const rows = await c.query<{ chat_id: string; status: string }>(
      `SELECT t.chat_id,a.status FROM approvals a
       JOIN targets t ON t.target_id=a.target_id
       WHERE a.tg_user_id=$1 AND a.attempt_id=$2 AND a.document_version=$3
         AND t.target_type='entry_group' AND t.chat_id=ANY($4::bigint[])`,
      [userId, attempt.attempt_id, documentVersion, [...ADMISSION_BOARD_CHAT_IDS]],
    );
    return allThreeBoardsApproved(rows.rows);
  });
  return ok ? attempt : undefined;
}

export async function resolveGateEntry(
  telegram: Telegram,
  userId: number,
  documentVersion: string,
  boards: readonly BoardTarget[],
  blacklisted: boolean,
): Promise<GateEntryRoute> {
  if (blacklisted) return { kind: "blocked", joined: [], pending: [] };
  const { joined, pending } = await membershipForBoards(telegram, userId, boards);
  const attempt = await latestSharedApproval(userId, documentVersion);
  if (
    attempt &&
    joined.length === ADMISSION_BOARD_CHAT_IDS.length &&
    pending.length === 0
  ) {
    return { kind: "member_direct", attempt, joined, pending: [] };
  }
  if (attempt) {
    return {
      kind: "approved_join",
      attempt,
      joined,
      pending,
    };
  }
  return { kind: "fresh", joined, pending };
}

export async function showMemberDirectLinks(
  telegram: Telegram,
  userId: number,
  boards: readonly BoardTarget[],
  membership: { joined: number[]; pending: number[] },
): Promise<void> {
  const rows = boards.flatMap((b, i) => {
    const inGroup = membership.joined.includes(b.chatId);
    return inGroup
      ? [Markup.button.url(`${i + 1}．${b.title}`, groupDeepLink(b.chatId))]
      : [];
  });
  const text =
    "✅ すでに参加済みです。審査の再回答は不要です。各掲示板へは下のボタンから移動してください。";
  const out = await showWizardScreen(
    telegram,
    userId,
    undefined,
    text,
    rows.length ? Markup.inlineKeyboard([rows.slice(0, 2), ...(rows.length > 2 ? [rows.slice(2)] : [])]) : undefined,
  );
  const a = await readAttempt(userId);
  if (a) await rememberScreen(a, out.messageId);
}
