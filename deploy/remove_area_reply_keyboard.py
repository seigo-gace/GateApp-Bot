#!/usr/bin/env python3
"""Idempotent ReplyKeyboardRemove for Area's BBS general-guide topic only."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

AREA_CHAT_ID = -1003847210571
NOTICE = (
    "📌 旧キーボードメニューは廃止しました。"
    "今後は総合案内の投稿ボタンをご利用ください。"
)


def psql(sql: str) -> str:
    if subprocess.run(["which", "psql"], capture_output=True).returncode != 0:
        cmd = [
            "docker",
            "exec",
            "deploy-postgres-1",
            "psql",
            "-U",
            "gace",
            "-d",
            "gaybbs",
            "-t",
            "-A",
            "-c",
            sql,
        ]
    else:
        cmd = [
            "psql",
            os.environ.get(
                "DATABASE_URL",
                "postgresql://gace:devlocalpass123@127.0.0.1:55432/gaybbs",
            ),
            "-t",
            "-A",
            "-c",
            sql,
        ]
    return subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT).strip()


def load_token() -> str:
    env = os.environ.get("BOT_TOKEN", "").strip()
    if env:
        return env
    here = Path(__file__).resolve().parent
    for name in ("secrets/bot_token.txt", "bot_token.txt"):
        path = here / name
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
    raise SystemExit("BOT_TOKEN not configured")


def tg_api(token: str, method: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read().decode("utf-8"))
    if not body.get("ok"):
        raise SystemExit(f"Telegram {method} failed: {body.get('description', body)}")
    return body["result"]


def main() -> None:
    thread_raw = psql(
        "SELECT message_thread_id FROM general_guide_topics "
        f"WHERE chat_id={AREA_CHAT_ID} AND enabled=TRUE"
    )
    if not thread_raw or "|" in thread_raw:
        raise SystemExit("general_guide_topics not uniquely verified for Area BBS")
    thread_id = int(thread_raw)

    existing = psql(
        "SELECT message_id FROM area_legacy_reply_keyboard_removals "
        f"WHERE chat_id={AREA_CHAT_ID}"
    )
    if existing:
        row = psql(
            "SELECT message_thread_id,message_id FROM area_legacy_reply_keyboard_removals "
            f"WHERE chat_id={AREA_CHAT_ID}"
        )
        parts = row.split("|") if "|" in row else [row, existing]
        print(
            json.dumps(
                {
                    "status": "skipped",
                    "chat_id": AREA_CHAT_ID,
                    "message_thread_id": int(parts[0]),
                    "message_id": int(parts[1] if len(parts) > 1 else existing),
                }
            )
        )
        return

    token = load_token()
    me = tg_api(token, "getMe", {})
    if str(me.get("username", "")).lower() != "gaybbs_bot":
        raise SystemExit("BOT_IDENTITY_MISMATCH")

    member = tg_api(
        token,
        "getChatMember",
        {"chat_id": AREA_CHAT_ID, "user_id": me["id"]},
    )
    if member.get("status") not in ("administrator", "creator"):
        raise SystemExit("BOT_NOT_ADMIN_IN_AREA_BBS")

    payload = {
        "chat_id": AREA_CHAT_ID,
        "text": NOTICE,
        "reply_markup": {"remove_keyboard": True, "selective": False},
    }
    used_thread = thread_id
    try:
        sent = tg_api(
            token,
            "sendMessage",
            {**payload, "message_thread_id": thread_id},
        )
    except SystemExit as exc:
        if "message thread not found" not in str(exc).lower():
            raise
        # DB may still hold bootstrap placeholder (1). Forum General accepts no thread id.
        sent = tg_api(token, "sendMessage", payload)
        used_thread = 0
    message_id = int(sent["message_id"])
    psql(
        "INSERT INTO area_legacy_reply_keyboard_removals "
        f"(chat_id,message_thread_id,message_id,verified_by) "
        f"VALUES ({AREA_CHAT_ID},{used_thread},{message_id},0)"
    )
    print(
        json.dumps(
            {
                "status": "removed",
                "chat_id": AREA_CHAT_ID,
                "message_thread_id": used_thread,
                "message_id": message_id,
                "url": f"https://t.me/c/3847210571/{message_id}",
            }
        )
    )


if __name__ == "__main__":
    main()
