#!/usr/bin/env python3
"""Insert feature gates only when phase-a-admin-dm-e2e-template.json is fully evidenced."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "phase-a-admin-dm-e2e-template.json"
ADMIN = int(json.loads((ROOT / "menu-topic-ledger-v1.json").read_text(encoding="utf-8"))["admin_telegram_id"])


def main() -> int:
    data = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    if data.get("status") == "NOT_EXECUTED_BY_COMPOSER":
        print("ABORT: Phase A not executed; template still NOT_EXECUTED_BY_COMPOSER", file=sys.stderr)
        return 3
    cmds = data.get("commands", [])
    by_feature: dict[str, dict] = {}
    for c in cmds:
        feat = c["feature"]
        ev = c.get("evidence_fields", {})
        if not ev.get("dm_message_id") or not ev.get("observed_at_utc"):
            print(f"ABORT: missing evidence for {c.get('command')}", file=sys.stderr)
            return 2
        by_feature.setdefault(feat, []).append(c)
    required = {"announcement", "room", "link", "search", "help"}
    if not required.issubset(by_feature):
        print("ABORT: not all features evidenced", file=sys.stderr)
        return 2
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if len(head) != 40:
        print("ABORT: source_commit not 40 hex", file=sys.stderr)
        return 2
    receipt = json.dumps(
        {"phase_a": data.get("status"), "commands": [c["command"] for c in cmds]},
        ensure_ascii=False,
    )
    for feature in sorted(required):
        sql = f"""
        INSERT INTO gaybbs_feature_release_gates
          (feature,source_commit,ci_evidence,gserver_runtime_evidence,telegram_e2e_evidence,approved_by,enabled)
        VALUES (
          '{feature}','{head}',
          'artifacts/bot/tests/menuPanelRenderer.test.ts+posting handlers',
          'deploy-gaybbs-1 long-polling runtime',
          '{receipt.replace("'", "''")}',
          {ADMIN},TRUE
        )
        ON CONFLICT (feature) DO UPDATE SET
          source_commit=EXCLUDED.source_commit,
          telegram_e2e_evidence=EXCLUDED.telegram_e2e_evidence,
          approved_at=NOW(), enabled=TRUE;
        """
        subprocess.check_call(
            [
                "docker",
                "exec",
                "-i",
                "deploy-postgres-1",
                "psql",
                "-U",
                "gace",
                "-d",
                "gaybbs",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            input=sql.encode(),
        )
    print(json.dumps({"status": "gates_recorded", "features": sorted(required)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
