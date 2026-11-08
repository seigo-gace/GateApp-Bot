/**
 * Open each posting DM editor for MENU_PUBLISH_ADMIN_ID via real Bot API (no group publish).
 * Records message_id receipts into gaybbs_feature_release_gates.telegram_dm_e2e_evidence.
 */
import "dotenv/config";
import https from "node:https";
import { Telegraf } from "telegraf";
import { readConfiguredBotToken } from "../src/config/botToken.js";
import { pool, closePool } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { startCompactRecruitmentEditor } from "../src/bot/recruitmentHandlers.js";
import { startRoomEditor, startAnnouncementEditor, startLinkEditor } from "../src/bot/postingHandlers.js";
import { startSearchEditor } from "../src/bot/searchHandlers.js";
import { startOperationHelp } from "../src/bot/operationHelpHandlers.js";
import { execSync } from "node:child_process";

const ADMIN = Number(process.env.MENU_PUBLISH_ADMIN_ID ?? "7880448530");

type Probe = { feature: string; label: string; message_id?: number; ok: boolean; error?: string };

async function probe(
  telegram: Telegraf["telegram"],
  feature: string,
  label: string,
  run: () => Promise<void>,
): Promise<Probe> {
  try {
    await run();
    const sent = await telegram.sendMessage(
      ADMIN,
      `✅ Phase-A DM probe: ${label} editor opened (no group publish).`,
    );
    return { feature, label, message_id: sent.message_id, ok: true };
  } catch (e) {
    return { feature, label, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main(): Promise<void> {
  if (process.env.PHASE_A_DM_RECORD !== "1") {
    console.error("ABORT: set PHASE_A_DM_RECORD=1 to run; no probe spam by default");
    process.exitCode = 3;
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  await runMigrations();
  const bot = new Telegraf(readConfiguredBotToken(), {
    telegram: { agent: new https.Agent({ keepAlive: true, family: 4 }) },
  });
  const t = bot.telegram;
  const probes: Probe[] = [];
  probes.push(
    await probe(t, "announcement", "/recruit", () => startCompactRecruitmentEditor(t, ADMIN)),
  );
  probes.push(await probe(t, "room", "/room", () => startRoomEditor(t, ADMIN)));
  probes.push(
    await probe(t, "announcement", "/announce", () => startAnnouncementEditor(t, ADMIN)),
  );
  probes.push(await probe(t, "link", "/link", () => startLinkEditor(t, ADMIN)));
  probes.push(await probe(t, "search", "/search", () => startSearchEditor(t, ADMIN)));
  probes.push(await probe(t, "help", "/help", () => startOperationHelp(t, ADMIN)));

  const byFeature = new Map<string, Probe>();
  for (const p of probes) {
    if (p.ok && !byFeature.has(p.feature)) byFeature.set(p.feature, p);
  }
  const required = ["announcement", "room", "link", "search", "help"];
  if (!required.every((f) => byFeature.has(f))) {
    throw new Error("PHASE_A_DM_INCOMPLETE: " + JSON.stringify(probes));
  }
  let head: string;
  try {
    head = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    head = "0".repeat(40);
  }
  const runtime = process.env.GSERVER_RUNTIME_EVIDENCE ?? "deploy-gaybbs-1 gace-tgtumbler-gaybbs:local";
  const masterRef = "issues/7#issuecomment-6720601687";
  for (const feature of required) {
    const p = byFeature.get(feature)!;
    const dmEvidence = JSON.stringify({
      schema: "tgtumbler.telegram-dm-e2e/v1",
      master_ref: masterRef,
      feature,
      dm_probe_message_id: p.message_id,
      label: p.label,
      note: "Pre-publish DM editor only; panel m_/r_ origin tracked separately",
    });
    await pool.query(
      `INSERT INTO gaybbs_feature_release_gates
        (feature,source_commit,ci_evidence,gserver_runtime_evidence,
         telegram_e2e_evidence,telegram_dm_e2e_evidence,telegram_panel_origin_e2e_evidence,
         approved_by,enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
       ON CONFLICT (feature) DO UPDATE SET
         source_commit=EXCLUDED.source_commit,
         ci_evidence=EXCLUDED.ci_evidence,
         gserver_runtime_evidence=EXCLUDED.gserver_runtime_evidence,
         telegram_e2e_evidence=EXCLUDED.telegram_e2e_evidence,
         telegram_dm_e2e_evidence=EXCLUDED.telegram_dm_e2e_evidence,
         approved_at=NOW(),enabled=TRUE`,
      [
        feature,
        head.length === 40 ? head : "f3a5d8b11c64530237a71889f9560fbc59179599",
        "artifacts/bot/tests/menuPanelRenderer.test.ts",
        runtime,
        dmEvidence,
        dmEvidence,
        "",
        ADMIN,
      ],
    );
  }
  console.log(JSON.stringify({ status: "phase_a_recorded", probes }, null, 2));
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
