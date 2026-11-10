#!/usr/bin/env python3
"""Read-only Telegram probes: pinned chat message, copyMessage from known protected refs."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ADMIN = int(json.loads((ROOT / "menu-topic-ledger-v1.json").read_text(encoding="utf-8"))["admin_telegram_id"])

GROUPS = [
    ("area_bbs", -1003847210571, 43),
    ("video_chat", -1002373696859, 1723),
    ("gay_board", -1003770334893, 783),
]

# Protected refs only — not guessing guide doc IDs.
COPY_CANDIDATES = [
    ("online_card_area", -1003847210571, 1138),
    ("online_card_video", -1002373696859, 4546),
    ("online_card_gay", -1003770334893, 1039),
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
            return {"ok": False, "description": body[:400]}


def main() -> None:
    out = {
        "schema": "tgtumbler.guide-topic-visibility-probe/v1",
        "master_ref": "issues/7#issuecomment-6720049968",
        "groups": [],
        "copy_checks": [],
        "document_index_conclusion": {
            "general_guide_documents_db": 0,
            "bot_can_enumerate_forum_thread_messages": False,
            "legal_telegram_message_id_in_repo_ledger": False,
            "notion_markdown_in_repo": "server-core/.../docs/tgtumbler-pages/content/*.md (no message_id)",
            "minimal_bind_operations_if_posts_exist_in_client": [
                "Per board: open general_guide topic, reply to each pinned/legal post, /bindguidemessage <type>",
                "Required types: terms, rules, safety, privacy, howto",
            ],
        },
    }
    for key, chat_id, thread_id in GROUPS:
        chat = api("getChat", {"chat_id": chat_id})
        pin = (chat.get("result") or {}).get("pinned_message")
        row = {
            "board_key": key,
            "chat_id": chat_id,
            "general_guide_thread_id": thread_id,
            "getChat_ok": chat.get("ok", False),
            "group_pinned_message_id": pin.get("message_id") if pin else None,
            "group_pinned_thread_id": pin.get("message_thread_id") if pin else None,
            "note": "Group-level pin is not per-forum-topic; does not prove guide docs inside thread",
        }
        out["groups"].append(row)

    for key, chat_id, message_id in COPY_CANDIDATES:
        copied = api(
            "copyMessage",
            {"chat_id": ADMIN, "from_chat_id": chat_id, "message_id": message_id},
        )
        ok = copied.get("ok", False)
        dm_mid = (copied.get("result") or {}).get("message_id")
        preview = None
        if ok and dm_mid:
            preview = api(
                "forwardMessage",
                {"chat_id": ADMIN, "from_chat_id": ADMIN, "message_id": dm_mid},
            )
            api("deleteMessage", {"chat_id": ADMIN, "message_id": dm_mid})
        out["copy_checks"].append(
            {
                "key": key,
                "chat_id": chat_id,
                "message_id": message_id,
                "copy_ok": ok,
                "error": None if ok else copied,
                "dm_copy_deleted": bool(ok and dm_mid),
            }
        )

    path = ROOT / "guide-topic-visibility-probe-20261108.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"receipt": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
