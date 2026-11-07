#!/usr/bin/env python3
"""Inspect/suppress Gay Board's @GayBBS_bot command menu only.

This does NOT alter other bots' commands or Telegram-native Stars.
Default is read-only. --apply writes empty chat-scoped lists ONLY after
identity and permission checks; prints effective scoped command lists for review.
"""
from __future__ import annotations
import argparse
import json
import os
import urllib.request
import urllib.error
from pathlib import Path

CHAT_ID = -1003770334893
BOT_ID = 8872855519
SCOPES = [
    {"type": "chat", "chat_id": CHAT_ID},
    {"type": "chat_administrators", "chat_id": CHAT_ID},
]

def call(token: str, method: str, data: dict) -> dict:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            response = json.load(resp)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{method} HTTP {exc.code}") from None
    if not response.get("ok"):
        raise RuntimeError(f"{method} error {response.get('error_code')}")
    return response["result"]

def run(apply: bool) -> None:
    token_file = os.environ.get(
        "BOT_TOKEN_FILE",
        "/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt",
    )
    token = os.environ.get("BOT_TOKEN") or Path(token_file).read_text().strip()
    me = call(token, "getMe", {})
    if me.get("id") != BOT_ID or me.get("username", "").lower() != "gaybbs_bot":
        raise RuntimeError("WRONG_BOT_IDENTITY")
    chat = call(token, "getChat", {"chat_id": CHAT_ID})
    if chat.get("id") != CHAT_ID or chat.get("type") != "supergroup":
        raise RuntimeError("WRONG_GROUP")
    bot = call(token, "getChatMember", {"chat_id": CHAT_ID, "user_id": BOT_ID})
    if bot.get("status") not in ("administrator", "creator"):
        raise RuntimeError("BOT_NOT_ADMIN")
    for scope in SCOPES:
        before = call(token, "getMyCommands", {"scope": scope})
        print(json.dumps({"scope": scope["type"], "before": before}, ensure_ascii=False))
    inherited = []
    for scope in ({"type":"all_group_chats"},{"type":"default"}):
        commands = call(token, "getMyCommands", {"scope": scope})
        inherited.append({"scope":scope["type"],"commands":commands})
    print(json.dumps({"inherited_scopes_read_only": inherited}, ensure_ascii=False))
    if not apply:
        print("PREVIEW_ONLY. This cannot modify commands belonging to OTHER bots.")
        return
    for scope in SCOPES:
        call(token, "setMyCommands", {"scope": scope, "commands": []})
        after = call(token, "getMyCommands", {"scope": scope})
        if after:
            raise RuntimeError("SCOPE_READBACK_NOT_EMPTY:"+scope["type"])
        print(json.dumps({"scope":scope["type"],"status":"SCOPE_EMPTY_READBACK"},ensure_ascii=False))
    print("GAY_BOARD_COMMAND_SCOPES_EMPTY; verify actual Telegram UI and inherited/other-bot menus.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    run(parser.parse_args().apply)
