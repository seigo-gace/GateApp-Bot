#!/usr/bin/env python3
"""Suppress slash-command menu for Area's BBS (@GayBBS_bot scopes + legacy bot exit)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

AREA_CHAT_ID = -1003847210571
LEGACY_BOT_ID = 8086265383
SCOPES = (
    {"type": "chat", "chat_id": AREA_CHAT_ID},
    {"type": "chat_administrators", "chat_id": AREA_CHAT_ID},
)


def psql(sql: str) -> str:
    if subprocess.run(["which", "psql"], capture_output=True).returncode != 0:
        cmd = [
            "docker", "exec", "deploy-postgres-1",
            "psql", "-U", "gace", "-d", "gaybbs", "-t", "-A", "-c", sql,
        ]
    else:
        cmd = [
            "psql",
            os.environ.get("DATABASE_URL", "postgresql://gace:devlocalpass123@127.0.0.1:55432/gaybbs"),
            "-t", "-A", "-c", sql,
        ]
    return subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT).strip()


def load_token() -> str:
    for path in (
        Path(__file__).resolve().parent / "secrets/bot_token.txt",
        Path("/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt"),
    ):
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
    raise SystemExit("BOT_TOKEN not configured")


def tg(token: str, method: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read().decode())
    if not body.get("ok"):
        raise SystemExit(f"{method} failed: {body.get('description', body)}")
    return body.get("result", {})


def audit_commands(token: str) -> dict:
    out: dict[str, list[str]] = {}
    for sc in (
        {"type": "default"},
        {"type": "all_group_chats"},
        *SCOPES,
    ):
        cmds = tg(token, "getMyCommands", {"scope": sc})
        out[sc["type"]] = [c["command"] for c in cmds]
    return out


def main() -> None:
    token = load_token()
    me = tg(token, "getMe", {})
    if str(me.get("username", "")).lower() != "gaybbs_bot":
        raise SystemExit("BOT_IDENTITY_MISMATCH")

    before = audit_commands(token)
    cleared: list[str] = []
    for sc in SCOPES:
        tg(token, "deleteMyCommands", {"scope": sc})
        tg(token, "setMyCommands", {"scope": sc, "commands": []})
        cleared.append(sc["type"])

    legacy_status = tg(token, "getChatMember", {"chat_id": AREA_CHAT_ID, "user_id": LEGACY_BOT_ID}).get("status", "unknown")
    legacy_removed = False
    if legacy_status in ("member", "restricted"):
        tg(token, "banChatMember", {"chat_id": AREA_CHAT_ID, "user_id": LEGACY_BOT_ID, "revoke_messages": False})
        tg(token, "unbanChatMember", {"chat_id": AREA_CHAT_ID, "user_id": LEGACY_BOT_ID, "only_if_banned": True})
        legacy_removed = True
        legacy_status = tg(token, "getChatMember", {"chat_id": AREA_CHAT_ID, "user_id": LEGACY_BOT_ID}).get("status", "unknown")

    after = audit_commands(token)
    psql(
        "CREATE TABLE IF NOT EXISTS area_command_menu_suppressions ("
        "chat_id BIGINT PRIMARY KEY, scopes_cleared TEXT NOT NULL, "
        "legacy_bot_id BIGINT NOT NULL, legacy_bot_status TEXT NOT NULL, "
        "legacy_bot_removed BOOLEAN NOT NULL DEFAULT FALSE, "
        "suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), verified_by BIGINT)"
    )
    psql(
        "INSERT INTO area_command_menu_suppressions "
        f"(chat_id,scopes_cleared,legacy_bot_id,legacy_bot_status,legacy_bot_removed,verified_by) "
        f"VALUES ({AREA_CHAT_ID},'{','.join(cleared)}',{LEGACY_BOT_ID},'{legacy_status}',"
        f"{'TRUE' if legacy_removed else 'FALSE'},0) "
        "ON CONFLICT (chat_id) DO UPDATE SET "
        "scopes_cleared=EXCLUDED.scopes_cleared, legacy_bot_status=EXCLUDED.legacy_bot_status, "
        "legacy_bot_removed=EXCLUDED.legacy_bot_removed OR area_command_menu_suppressions.legacy_bot_removed, "
        "suppressed_at=NOW()"
    )
    result = {
        "chat_id": AREA_CHAT_ID,
        "bot": "@GayBBS_bot",
        "scopes_cleared": cleared,
        "getMyCommands_before": before,
        "getMyCommands_after": after,
        "legacy_bot_id": LEGACY_BOT_ID,
        "legacy_bot_username": "@ShowTimeLIVE_Bot",
        "legacy_bot_status": legacy_status,
        "legacy_bot_removed": legacy_removed,
    }
    out = Path(__file__).resolve().parent / "area-command-menu-removal-result.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
