#!/usr/bin/env python3
"""Probe forum topic IDs via sendMessage+deleteMessage (no content kept)."""
from __future__ import annotations

import json
import os
import subprocess
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CANDIDATES = [
    *json.loads((ROOT / "online-topic-verified.json").read_text(encoding="utf-8"))["topics"],
    {
        "key": "community_area",
        "chat_id": -1003847210571,
        "message_thread_id": 273,
        "source": "community-link-topics.json",
    },
    {
        "key": "community_video",
        "chat_id": -1002373696859,
        "message_thread_id": 1724,
        "source": "community-link-topics.json",
    },
    {
        "key": "community_gay",
        "chat_id": -1003770334893,
        "message_thread_id": 18,
        "source": "community-link-topics.json",
    },
    {
        "key": "notion_general_guide_video",
        "chat_id": -1002373696859,
        "message_thread_id": 1723,
        "source": "notion_topic_ledger_record_only",
    },
    {
        "key": "notion_general_guide_gay",
        "chat_id": -1003770334893,
        "message_thread_id": 783,
        "source": "notion_topic_ledger_record_only",
    },
]


def token() -> str:
    path = ROOT / "secrets" / "bot_token.txt"
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    env = Path.home() / ".config/gace/tgtumbler/gaybbs-bot.env"
    line = env.read_text(encoding="utf-8").strip()
    if line.startswith("BOT_TOKEN="):
        return line.split("=", 1)[1].strip()
    return line


def api(method: str, fields: dict) -> dict:
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token()}/{method}",
        data=data,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def probe(chat_id: int, thread_id: int) -> dict:
    try:
        sent = api(
            "sendMessage",
            {
                "chat_id": str(chat_id),
                "message_thread_id": str(thread_id),
                "text": "🔒 TGtumbler topic probe (deleted immediately)",
            },
        )
        if not sent.get("ok"):
            return {"ok": False, "error": sent.get("description", "unknown")}
        mid = sent["result"]["message_id"]
        deleted = api("deleteMessage", {"chat_id": str(chat_id), "message_id": str(mid)})
        return {
            "ok": True,
            "probe_message_id": mid,
            "deleted": bool(deleted.get("ok")),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def main() -> int:
    receipts = []
    for item in CANDIDATES:
        chat_id = int(item["chat_id"])
        thread_id = int(item["message_thread_id"])
        receipts.append(
            {
                "key": item.get("key", "unknown"),
                "chat_id": chat_id,
                "message_thread_id": thread_id,
                "source": item.get("source", item.get("ledger_url", "online-topic-verified.json")),
                **probe(chat_id, thread_id),
            }
        )
    out = {
        "schema": "tgtumbler.forum-topic-probe/v1",
        "verified_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "method": "sendMessage+deleteMessage",
        "note": "Probe success means Bot can post in the forum thread; not automatic 総合案内/投稿メニュー assignment.",
        "topics": receipts,
    }
    target = ROOT / "forum-topic-probe-20261108.json"
    target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))
    return 0 if all(r["ok"] for r in receipts) else 2


if __name__ == "__main__":
    raise SystemExit(main())
