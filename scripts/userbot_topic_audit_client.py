#!/usr/bin/env python3
"""Read-only existing resident Userbot IPC client; never opens Telegram session."""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import pathlib
import stat
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from userbot_resident_ipc import SOCKET_PATH
ALLOWED = (-1003847210571, -1002373696859, -1003770334893)


async def inspect(chat_id: int, page: int):
    if chat_id not in ALLOWED or type(page) is not int or not 0 <= page <= 24:
        raise ValueError("TOPIC_AUDIT_TARGET_DENIED")
    if not SOCKET_PATH.is_socket():
        raise RuntimeError("RESIDENT_USERBOT_IPC_NOT_AVAILABLE")
    info = SOCKET_PATH.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError("RESIDENT_USERBOT_IPC_PERMISSIONS_INVALID")
    reader, writer = await asyncio.wait_for(
        asyncio.open_unix_connection(str(SOCKET_PATH), limit=262144), 5)
    try:
        request_id = uuid.uuid4().hex
        payload = {"request_id": request_id, "action": "topic_entry_audit",
                   "chat_id": chat_id, "page": page}
        writer.write((json.dumps(payload) + "\n").encode())
        await writer.drain()
        data = await asyncio.wait_for(reader.readline(), 110)
        result = json.loads(data)
        if result.get("request_id") != request_id or result.get("status") != "PASS":
            raise RuntimeError("TOPIC_AUDIT_IPC_FAILURE_" + str(result.get("error", "UNKNOWN")))
        if not isinstance(result.get("rows"), list):
            raise RuntimeError("TOPIC_AUDIT_RESULT_INVALID")
        return result
    finally:
        writer.close()
        await writer.wait_closed()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chat-id", type=int, choices=ALLOWED, required=True)
    parser.add_argument("--page", type=int, default=0)
    args = parser.parse_args()
    try:
        result = asyncio.run(inspect(args.chat_id, args.page))
        print("USERBOT_TOPIC_AUDIT=" + json.dumps(result, ensure_ascii=False,
                                               separators=(",", ":")))
        return 0
    except Exception as exc:
        print("USERBOT_TOPIC_AUDIT=FAILED")
        print("USERBOT_TOPIC_AUDIT_ERROR=" + type(exc).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
