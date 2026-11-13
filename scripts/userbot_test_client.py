#!/usr/bin/env python3
"""Bounded client of the EXISTING resident Userbot socket; never opens auth session."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import stat
import sys
import uuid
from userbot_resident_ipc import SOCKET_PATH, ACTIONS


async def invoke(action: str, chat_id: int | None = None, message_id: int | None = None, page: int | None = None) -> dict:
    if not SOCKET_PATH.exists() or not SOCKET_PATH.is_socket():
        raise RuntimeError("RESIDENT_USERBOT_IPC_NOT_AVAILABLE")
    sockstat = SOCKET_PATH.stat()
    if sockstat.st_uid != os.getuid() or stat.S_IMODE(sockstat.st_mode) != 0o600:
        raise RuntimeError("RESIDENT_USERBOT_IPC_PERMISSIONS_INVALID")
    reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(str(SOCKET_PATH)), 5)
    try:
        request_id = uuid.uuid4().hex
        request = {"request_id": request_id, "action": action}
        if action == "room_public_readback":
            if chat_id is None or message_id is None:
                raise ValueError("ROOM_READ_TARGET_REQUIRED")
            request.update({"chat_id": chat_id, "message_id": message_id})
        elif action == "topic_entry_audit":
            if chat_id is None or page is None or message_id is not None:
                raise ValueError("TOPIC_AUDIT_TARGET_REQUIRED")
            request.update({"chat_id": chat_id, "page": page})
        elif chat_id is not None or message_id is not None or page is not None:
            raise ValueError("READ_TARGET_ONLY_FOR_READBACK")
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()
        reply = await asyncio.wait_for(reader.readline(), 100 if action in {"room_public_post_smoke", "topic_entry_audit"} else 40)
        result = json.loads(reply)
        if result.get("request_id") not in {request_id, None}:
            raise RuntimeError("USERBOT_IPC_REQUEST_ID_MISMATCH")
        return result
    finally:
        writer.close()
        await writer.wait_closed()


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe resident Userbot verification")
    parser.add_argument("action", choices=sorted(ACTIONS))
    parser.add_argument("--chat-id", type=int)
    parser.add_argument("--message-id", type=int)
    parser.add_argument("--page", type=int)
    args = parser.parse_args()
    try:
        result = asyncio.run(invoke(args.action, args.chat_id, args.message_id, args.page))
        if result.get("status") != "PASS":
            print("USERBOT_TEST_RESULT=FAIL")
            print("USERBOT_TEST_ERROR=" + re.sub(r"[^A-Z0-9_]", "_", str(result.get("error", "CONTRACT_MISMATCH")).upper())[:128])
            return 1
        print("USERBOT_TEST_RESULT=PASS")
        print("USERBOT_TEST_ACTION=" + args.action)
        if args.action == "topic_entry_audit":
            import json
            print("USERBOT_TOPIC_AUDIT=" + json.dumps(result, ensure_ascii=False, sort_keys=True))
        if "row_sizes" in result:
            print("USERBOT_TEST_MENU_ROWS=" + ",".join(map(str, result["row_sizes"])))
        if "steps" in result:
            print("USERBOT_TEST_STEPS=" + ",".join(str(step) for step in result["steps"]))
        if args.action == "room_public_post_smoke":
            print("USERBOT_ROOM_PUBLIC_POST=" + ("PASS" if result.get("published") else "FAIL"))
            print("USERBOT_ROOM_PUBLIC_FINISH_DM=" + ("PASS" if result.get("finished_dm") else "FAIL"))
        if "marker" in result:
            print("USERBOT_ROOM_PUBLIC_MARKER=" + result["marker"])
            print("USERBOT_ROOM_PUBLIC_JOIN_BUTTON=" + ("YES" if result["has_join_button"] else "NO"))
        return 0
    except Exception as exc:
        print("USERBOT_TEST_RESULT=BLOCKED")
        print("USERBOT_TEST_ERROR=" + type(exc).__name__)
        return 2


if __name__ == "__main__":
    sys.exit(main())
