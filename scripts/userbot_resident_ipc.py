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
MAX_RESPONSE_BYTES = 65536
REQUEST_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
ACTIONS = frozenset({"health", "bot_start_menu", "room_private_smoke", "list_joined_public_channels", "list_channel_videos", "download_channel_video", "download_channel_video_step"})
EXPECTED_MENU = [
    ["相手募集", "募集+Room", "告知/予告"],
    ["プロフ作成", "クリエーター有料ビデオ投稿"],
    ["🔗ボタン作成", "検索/フィルター"],
    ["雑談", "紹介/招待", "操作説明"],
]


async def process_request(client: Any, request: Any) -> dict[str, Any]:
    if not isinstance(request, dict) or not {"request_id", "action"} <= set(request) or set(request) - {"request_id", "action", "channel_id", "message_id", "limit"}:
        raise ValueError("REQUEST_SHAPE_INVALID")
    request_id = request["request_id"]
    action = request["action"]
    if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
        raise ValueError("REQUEST_ID_INVALID")
    if action not in ACTIONS:
        raise ValueError("ACTION_NOT_ALLOWLISTED")
    if not await client.is_user_authorized():
        raise RuntimeError("RESIDENT_USERBOT_NOT_AUTHORIZED")
    if action in {"list_joined_public_channels", "list_channel_videos", "download_channel_video", "download_channel_video_step"}:
        from userbot_public_video_actions import joined_public_channels, channel_videos, download_video
        required = {"request_id", "action"}
        if action == "list_joined_public_channels":
            if set(request) != required: raise ValueError("REQUEST_SHAPE_INVALID")
            return {"request_id": request_id, "action": action, "status": "PASS",
                    "channels": await joined_public_channels(client)}
        if action == "list_channel_videos":
            if set(request) != required | {"channel_id", "limit"}: raise ValueError("REQUEST_SHAPE_INVALID")
            videos = await channel_videos(client, request["channel_id"], request["limit"])
            return {"request_id": request_id, "action": action, "status": "PASS", "videos": videos}
        if set(request) != required | {"channel_id", "message_id"}: raise ValueError("REQUEST_SHAPE_INVALID")
        downloaded = await download_video(client, request["channel_id"], request["message_id"],
            max_chunks=16 if action == "download_channel_video_step" else None)
        return {"request_id": request_id, "action": action, "status": "PASS", **downloaded}
    if action == "health":
        return {"request_id": request_id, "action": action, "authorized": True,
                "connected": bool(client.is_connected()), "status": "PASS"}
    if action == "room_private_smoke":
        from userbot_room_smoke import run
        return {"request_id": request_id, **await run(client)}
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
                response = await asyncio.wait_for(process_request(client, request),
                    timeout=900 if request.get("action") == "download_channel_video" else 90 if request.get("action") == "download_channel_video_step" else 60)
        except Exception as exc:
            response = {"status": "FAIL", "error": type(exc).__name__ + ":" +
                        (str(exc) if isinstance(exc, (ValueError, RuntimeError, PermissionError)) else "INTERNAL")}
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
