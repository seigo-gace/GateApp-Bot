#!/usr/bin/env python3
"""Owner-only Unix socket for bounded tests THROUGH the resident Telegram client.

No auth state mutation, second session owner, logout, arbitrary code execution,
or generic Telegram API proxy. Socket is not exposed to the network.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import re
import socket
import struct
from typing import Any

from userbot_session import SECRETS

SOCKET_PATH = SECRETS / "userbot_verify.sock"
MAX_REQUEST_BYTES = 2048
MAX_RESPONSE_BYTES = 8192
REQUEST_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
ACTIONS = frozenset({"health", "bot_start_menu", "profile_button_smoke", "room_private_smoke", "room_public_readback", "room_public_post_smoke", "profile_topics_readback", "chat_selector_smoke", "invite_selector_smoke"})
# Project-approved groups only; never turn this into an arbitrary chat reader.
ROOM_READ_CHATS = frozenset({-1003847210571, -1002373696859, -1003770334893})
EXPECTED_MENU = [
    ["相手募集", "募集+Room", "告知/予告"],
    ["プロフ作成", "クリエーター有料ビデオ投稿"],
    ["🔗ボタン作成", "検索/フィルター"],
    ["雑談", "紹介/招待", "操作説明"],
]


async def process_request(client: Any, request: Any) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise ValueError("REQUEST_SHAPE_INVALID")
    action = request.get("action")
    expected = ({"request_id", "action", "chat_id", "message_id"}
                if action == "room_public_readback" else {"request_id", "action"})
    if set(request) != expected:
        raise ValueError("REQUEST_SHAPE_INVALID")
    request_id = request["request_id"]
    if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
        raise ValueError("REQUEST_ID_INVALID")
    if action not in ACTIONS:
        raise ValueError("ACTION_NOT_ALLOWLISTED")
    if not await client.is_user_authorized():
        raise RuntimeError("RESIDENT_USERBOT_NOT_AUTHORIZED")
    if action == "health":
        return {"request_id": request_id, "action": action, "authorized": True,
                "connected": bool(client.is_connected()), "status": "PASS"}
    if action == "profile_topics_readback":
        # Telegram's USER API returns real forum topic IDs, not t.me/c message
        # suffixes. Only inspect the three already-approved boards, read-only.
        from telethon import functions
        dialogs = await client.get_dialogs(limit=500)
        targets = (
            ("area_bbs", -1003847210571),
            ("video_chat", -1002373696859),
            ("gay_board", -1003770334893),
        )
        results = []
        for board, chat_id in targets:
            entity = next((d.entity for d in dialogs if d.id == chat_id), None)
            if entity is None:
                raise RuntimeError("PROFILE_READ_GROUP_NOT_IN_EXISTING_DIALOGS")
            forum = await client(functions.messages.GetForumTopicsRequest(
                peer=entity, q="みんなのプロフ",
                offset_date=0, offset_id=0, offset_topic=0, limit=100))
            matches = [t for t in forum.topics
                       if "みんなのプロフ" in getattr(t, "title", "")]
            if len(matches) > 1:
                raise RuntimeError("PROFILE_READ_MULTIPLE_TOPICS")
            results.append({"board": board, "chat_id": chat_id,
                            "thread_id": int(matches[0].id) if matches else None,
                            "found": len(matches) == 1})
        return {"request_id": request_id, "action": action, "status": "PASS",
                "topics": results}
    if action == "room_private_smoke":
        from userbot_room_smoke import run
        return {"request_id": request_id, **await run(client)}
    if action == "room_public_post_smoke":
        from userbot_room_public_smoke import run
        return {"request_id": request_id, **await run(client)}
    if action == "room_public_readback":
        chat_id, message_id = request["chat_id"], request["message_id"]
        if type(chat_id) is not int or chat_id not in ROOM_READ_CHATS:
            raise ValueError("ROOM_READ_CHAT_NOT_ALLOWLISTED")
        if type(message_id) is not int or not 1 <= message_id <= 2147483647:
            raise ValueError("ROOM_READ_MESSAGE_ID_INVALID")
        bot = await client.get_entity("GayBBS_bot")
        if not bot.bot:
            raise RuntimeError("TARGET_NOT_BOT")
        try:
            message = await client.get_messages(chat_id, ids=message_id)
        except ValueError:
            # The resident may be a joined member with a cold entity cache.
            # Resolve only from existing dialogs; NEVER join/invite/authenticate.
            dialogs = await client.get_dialogs(limit=500)
            existing = next((d.entity for d in dialogs if d.id == chat_id), None)
            if existing is None:
                raise RuntimeError("ROOM_READ_GROUP_NOT_IN_EXISTING_DIALOGS") from None
            message = await client.get_messages(existing, ids=message_id)
        if message is None or message.id != message_id:
            raise RuntimeError("ROOM_PUBLIC_MESSAGE_NOT_VISIBLE")
        if message.sender_id != bot.id:
            raise RuntimeError("ROOM_PUBLIC_MESSAGE_OWNER_MISMATCH")
        # Return classification only, never text/URL/identifiers or Telegram user data.
        status_lines = [line for line in (message.raw_text or "").splitlines()
                        if line.startswith("状態：")]
        marker = "unknown"
        if len(status_lines) == 1:
            last = status_lines[0]
            if "✅ 終了" in last:
                marker = "finished"
            elif "🔴 LIVE中" in last:
                marker = "live"
            elif "📅 予告中" in last:
                marker = "scheduled"
            elif "🚫 中止" in last:
                marker = "cancelled"
        has_join = any("参加" in getattr(button, "text", "")
                       for row in (message.buttons or []) for button in row)
        return {"request_id": request_id, "action": action, "status": "PASS",
                "marker": marker, "has_join_button": bool(has_join),
                "is_owned_bot_message": True}
    bot = await client.get_entity("GayBBS_bot")
    if not bot.bot:
        raise RuntimeError("TARGET_NOT_BOT")
    before = await client.get_messages(bot, limit=1)
    cursor = before[0].id if before else 0
    await client.send_message(bot, "/start")
    for _ in range(12):
        messages = await client.get_messages(bot, limit=12)
        options = [m for m in messages if m.id > cursor and not m.out and m.buttons]
        if options:
            latest = max(options, key=lambda m: m.id)
            labels = [[b.text for b in row] for row in latest.buttons]
            if action in {"chat_selector_smoke", "invite_selector_smoke"}:
                if labels != EXPECTED_MENU:
                    raise RuntimeError("DM_POSTING_MENU_LAYOUT_MISMATCH")
                await latest.click(text="雑談" if action == "chat_selector_smoke" else "紹介/招待")
                for _ in range(12):
                    screen = await client.get_messages(bot, ids=latest.id)
                    if screen and screen.buttons:
                        actual = [[b.text for b in row] for row in screen.buttons]
                        if action == "chat_selector_smoke":
                            expected = [
                                ["ビデオChatの掲示板"],
                                ["エリア’s BBS"],
                                ["ゲイのための掲示板♂"],
                                ["🔙 戻る"],
                            ]
                            urls = [
                                "https://t.me/c/2373696859/4291",
                                "https://t.me/c/3847210571/44",
                                "https://t.me/c/3770334893/789",
                            ]
                            if actual == expected:
                                if [screen.buttons[i][0].url for i in range(3)] != urls:
                                    raise RuntimeError("CHAT_SELECTOR_URL_MISMATCH")
                                await screen.click(text="🔙 戻る")
                                return {"request_id": request_id, "action": action,
                                        "status": "PASS", "links_correct": True}
                        else:
                            if len(actual) == 4 and len(actual[0]) == len(actual[1]) == len(actual[2]) == 2 and actual[3] == ["🔙 戻る"]:
                                gate_codes = {"ee538b32b74f", "6f581d52e546", "e31b8d1dd707"}
                                # Telethon's KeyboardInlineButton wrapper does not expose
                                # the clipboard payload. Observe all three actual copy
                                # controls here; source contract separately validates copy_text.
                                if [actual[i][1] for i in range(3)] != ["🔗 コピー"] * 3:
                                    raise RuntimeError("INVITE_COPY_BUTTON_LABELS_MISMATCH")
                                choices = [screen.buttons[i][0].url for i in range(3)]
                                if any(not isinstance(u, str) or not (
                                    u.startswith("https://t.me/GayBBS_bot?start=gate_")
                                    or u.startswith("https://t.me/c/"))
                                    for u in choices):
                                    raise RuntimeError("INVITE_DESTINATIONS_INVALID")
                                await screen.click(text="🔙 戻る")
                                return {"request_id": request_id, "action": action,
                                        "status": "PASS", "visible_copy_controls": 3, "clipboard_readback": False}
                    await asyncio.sleep(1)
                raise RuntimeError("DM_SELECTOR_SCREEN_NOT_OPENED")
            if action == "profile_button_smoke":
                from datetime import datetime, timezone, timedelta
                if labels != EXPECTED_MENU:
                    raise RuntimeError("PROFILE_MENU_LAYOUT_INVALID")
                clicked_at = datetime.now(timezone.utc)
                await latest.click(text="プロフ作成")
                for _ in range(12):
                    recent = await client.get_messages(bot, limit=80)
                    for screen in recent:
                        if screen.out or "プロフィール｜相手募集と共通入力" not in (screen.raw_text or ""):
                            continue
                        updated_at = screen.edit_date or screen.date
                        if updated_at and updated_at >= clicked_at - timedelta(seconds=2):
                            return {"request_id": request_id, "action": action,
                                    "status": "PASS", "profile_editor_opened": True}
                    await asyncio.sleep(1)
                raise RuntimeError("PROFILE_BUTTON_SCREEN_NOT_OPENED")
            return {
                "request_id": request_id, "action": action,
                "status": "PASS" if labels == EXPECTED_MENU else "FAIL",
                "menu_matches_contract": labels == EXPECTED_MENU,
                "row_sizes": [len(row) for row in labels],
            }
        await asyncio.sleep(1)
    raise RuntimeError("BOT_START_RESPONSE_MISSING")


async def serve_resident(client: Any, stop: asyncio.Event) -> None:
    if SOCKET_PATH.is_symlink():
        raise RuntimeError("USERBOT_IPC_SOCKET_SYMLINK_REFUSED")
    if SOCKET_PATH.exists():
        # A stale socket is cleaned ONLY when this resident holds the
        # exclusive userbot lock; never remove the live owner's socket.
        SOCKET_PATH.unlink()
    lock = asyncio.Lock()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            raw_socket = writer.get_extra_info("socket")
            if raw_socket is None or not hasattr(socket, "SO_PEERCRED"):
                raise PermissionError("PEER_CREDENTIALS_UNAVAILABLE")
            pid, uid, gid = struct.unpack("3i", raw_socket.getsockopt(
                socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
            if uid != os.getuid():
                raise PermissionError("PEER_UID_NOT_ALLOWED")
            data = await asyncio.wait_for(reader.readline(), timeout=5)
            if len(data) >= MAX_REQUEST_BYTES or not data.endswith(b"\n"):
                raise ValueError("REQUEST_SIZE_INVALID")
            request = json.loads(data.decode("utf-8"))
            async with lock:
                response = await asyncio.wait_for(
                    process_request(client, request),
                    timeout=90 if request.get("action") == "room_public_post_smoke" else 30)
        except Exception as exc:
            # Never surface raw Telethon errors: they can include group/user IDs.
            safe_codes = {
                "REQUEST_SHAPE_INVALID", "REQUEST_ID_INVALID", "ACTION_NOT_ALLOWLISTED",
                "ROOM_READ_CHAT_NOT_ALLOWLISTED", "ROOM_READ_MESSAGE_ID_INVALID",
                "ROOM_PUBLIC_MESSAGE_NOT_VISIBLE", "ROOM_PUBLIC_MESSAGE_OWNER_MISMATCH",
                "ROOM_READ_GROUP_NOT_IN_EXISTING_DIALOGS", "RESIDENT_USERBOT_NOT_AUTHORIZED",
                "PROFILE_READ_GROUP_NOT_IN_EXISTING_DIALOGS", "PROFILE_READ_MULTIPLE_TOPICS",
                "TARGET_NOT_BOT", "PEER_UID_NOT_ALLOWED", "PEER_CREDENTIALS_UNAVAILABLE",
                "REQUEST_SIZE_INVALID",
            }
            code = str(exc) if str(exc) in safe_codes else "INTERNAL"
            response = {"status": "FAIL", "error": code}
        try:
            encoded = (json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8")
            if len(encoded) > MAX_RESPONSE_BYTES:
                encoded = b'{"status":"FAIL","error":"RESPONSE_TOO_LARGE"}\n'
            writer.write(encoded)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_unix_server(handle, path=str(SOCKET_PATH))
    os.chmod(SOCKET_PATH, 0o600)
    try:
        async with server:
            await stop.wait()
    finally:
        server.close()
        await server.wait_closed()
        if SOCKET_PATH.exists() and SOCKET_PATH.is_socket():
            SOCKET_PATH.unlink()
