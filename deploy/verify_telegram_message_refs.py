#!/usr/bin/env python3
"""Verify t.me/c/... message refs via forward to admin DM (no group posts)."""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ADMIN = int(json.loads((ROOT / "menu-topic-ledger-v1.json").read_text(encoding="utf-8"))["admin_telegram_id"])

CANDIDATES: list[tuple[str, int, str]] = [
    (-1003847210571, 1118, "posting_intro_area"),
    (-1003847210571, 116, "posting_freetalk_area"),
    (-1002373696859, 4531, "posting_intro_video"),
    (-1002373696859, 1605, "posting_freetalk_video"),
    (-1003770334893, 1028, "posting_intro_gay"),
    (-1003770334893, 4, "posting_freetalk_gay"),
    (-1002373696859, 1695, "creator_paid_video"),
]


def token() -> str:
    return (ROOT / "secrets" / "bot_token.txt").read_text(encoding="utf-8").strip()


def api(method: str, fields: dict) -> dict:
    data = urllib.parse.urlencode({k: str(v) for k, v in fields.items()}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token()}/{method}",
        data=data,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"ok": False, "error_code": exc.code, "description": body[:500]}


def main() -> int:
    results = []
    for chat_id, message_id, key in CANDIDATES:
        fwd = api(
            "forwardMessage",
            {"chat_id": ADMIN, "from_chat_id": chat_id, "message_id": message_id},
        )
        ok = bool(fwd.get("ok"))
        dm_id = fwd.get("result", {}).get("message_id") if ok else None
        if ok and dm_id:
            api("deleteMessage", {"chat_id": ADMIN, "message_id": dm_id})
        results.append(
            {
                "key": key,
                "chat_id": chat_id,
                "message_id": message_id,
                "forward_ok": ok,
                "error": None if ok else fwd,
            }
        )
    out = ROOT / "telegram-ref-verify-20261108.json"
    payload = {
        "schema": "tgtumbler.telegram-ref-verify/v1",
        "method": "forwardMessage_to_admin_dm_then_delete",
        "admin_telegram_id": ADMIN,
        "results": results,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"receipt": str(out), "all_ok": all(r["forward_ok"] for r in results)}, ensure_ascii=False))
    return 0 if all(r["forward_ok"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
