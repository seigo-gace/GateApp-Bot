#!/usr/bin/env python3
"""Read-only reconciliation of historical area links and Telegram Bot API evidence.

The Bot API does not provide getForumTopics/getForumTopic on api.telegram.org.
A send/delete success tests an ID's usability, NOT its title/area identity.
No database, Telegram, or deployment mutations are performed here.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

# Ordered candidate ledger from Issue #7, comment 6725669245.
# Crucially these are NOT Telegram-verified name-to-ID associations.
CANDIDATE_IDS = {
    "東北/青森": 50, "東北/秋田": 51, "東北/岩手": 52,
    "東北/宮城": 54, "東北/福島": 55,
    "甲信越/新潟": 56, "甲信越/長野": 57, "甲信越/山梨": 58,
    "北陸/富山": 59, "北陸/福井": 61,
    "北関東/群馬": 62, "北関東/栃木": 63, "北関東/茨城": 64,
    "東京/池袋": 65, "東京/渋谷": 67, "東京/品川": 68,
    "東京/都下": 71, "南関東/千葉": 72, "南関東/埼玉": 73,
    "南関東/横浜・川崎": 75, "南関東/町田・相模原・厚木": 76,
    "東海/静岡": 77,
}

def reconcile(master: dict, probe: dict, export: dict) -> dict:
    pending = master["pending_children_master_list"]
    if set(pending) != set(CANDIDATE_IDS) or len(pending) != 22:
        raise ValueError("PENDING_AREA_SET_MISMATCH")
    rows = probe["rows"]
    by_id = {int(row["candidate_topic_id"]): row for row in rows}
    if len(by_id) != len(rows) or set(by_id) != set(CANDIDATE_IDS.values()):
        raise ValueError("PROBE_CANDIDATES_MISMATCH")
    groups = [g for g in export["groups"] if g["board_key"] == "area_bbs"]
    if len(groups) != 1 or int(groups[0]["chat_id"]) != int(master["chat_id"]):
        raise ValueError("EXPORT_CHAT_MISMATCH")
    # Ledger-derived export titles do not demonstrate Topic title readback.
    exported_by_id = {int(t["message_thread_id"]): t for t in groups[0]["topics"]}
    results = []
    for name in pending:
        topic_id = CANDIDATE_IDS[name]
        probe_row = by_id[topic_id]
        exported = exported_by_id.get(topic_id)
        # Do not elevate a guess even after successful send/delete.
        name_confirmed = (
            exported is not None
            and exported.get("title_source") in {"bot_api_title_event", "telegram_service_event"}
            and exported.get("name") == name.split("/", 1)[1]
        )
        results.append({
            "area_key": name,
            "candidate_topic_id": topic_id,
            "candidate_url": f"https://t.me/c/3847210571/{topic_id}",
            "send_delete_success": probe_row.get("ok") is True and probe_row.get("deleted") is True,
            "topic_title_confirmed": name_confirmed,
            "db_upsert_authorized": bool(name_confirmed and probe_row.get("ok") and probe_row.get("deleted")),
        })
    return {
        "schema": "tgtumbler.area-topic-reconciliation/v1",
        "source_export_schema": export.get("schema"),
        "historical_seeded_children": len(master["verified_children"]),
        "candidate_count": len(results),
        "send_delete_success_count": sum(r["send_delete_success"] for r in results),
        "title_confirmed_count": sum(r["topic_title_confirmed"] for r in results),
        "ready_for_verified_db_upsert_count": sum(r["db_upsert_authorized"] for r in results),
        "result": "TITLE_EVIDENCE_REQUIRED" if not all(r["db_upsert_authorized"] for r in results) else "READY_FOR_DB_REVIEW",
        "warning": "Bot API send/delete success does not verify the topic title; no DB changes made.",
        "rows": results,
    }

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = p.parse_args()
    root = args.root
    def load(name: str) -> dict:
        return json.loads((root / "deploy" / name).read_text(encoding="utf-8"))
    result = reconcile(
        load("area-topic-url-master-6725069736.json"),
        load("area-child-topic-probe-20261109.json"),
        load("forum-topics-bot-api-export.json"),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
