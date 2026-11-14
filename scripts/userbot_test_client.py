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


async def invoke(action: str, channel_id: int | None = None, message_id: int | None = None, limit: int | None = None) -> dict:
    if not SOCKET_PATH.exists() or not SOCKET_PATH.is_socket():
        raise RuntimeError("RESIDENT_USERBOT_IPC_NOT_AVAILABLE")
    sockstat = SOCKET_PATH.stat()
    if sockstat.st_uid != os.getuid() or stat.S_IMODE(sockstat.st_mode) != 0o600:
        raise RuntimeError("RESIDENT_USERBOT_IPC_PERMISSIONS_INVALID")
    reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(str(SOCKET_PATH)), 5)
    try:
        request_id = uuid.uuid4().hex
        request = {"request_id": request_id, "action": action}\n        if channel_id is not None: request["channel_id"] = channel_id\n        if message_id is not None: request["message_id"] = message_id\n        if limit is not None: request["limit"] = limit\n        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()
        reply = await asyncio.wait_for(reader.readline(), 930)
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
    parser.add_argument("--channel-id", type=int)\n    parser.add_argument("--message-id", type=int)\n    parser.add_argument("--limit", type=int)\n    parser.add_argument("--json", action="store_true", help="Print bounded public metadata or storage reference")\n    args = parser.parse_args()
    try:
        result = asyncio.run(invoke(args.action, args.channel_id, args.message_id, args.limit))
        if result.get("status") != "PASS":
            print("USERBOT_TEST_RESULT=FAIL")
            print("USERBOT_TEST_ERROR=" + re.sub(r"[^A-Z0-9_]", "_", str(result.get("error", "CONTRACT_MISMATCH")).upper())[:128])
            return 1
        if args.json:\n            print(json.dumps(result, ensure_ascii=False))\n            return 0\n        print("USERBOT_TEST_RESULT=PASS")
        print("USERBOT_TEST_ACTION=" + args.action)
        if "row_sizes" in result:
            print("USERBOT_TEST_MENU_ROWS=" + ",".join(map(str, result["row_sizes"])))
        if "steps" in result:
            print("USERBOT_TEST_STEPS=" + ",".join(str(step) for step in result["steps"]))
        return 0
    except Exception as exc:
        print("USERBOT_TEST_RESULT=BLOCKED")
        print("USERBOT_TEST_ERROR=" + type(exc).__name__)
        return 2


if __name__ == "__main__":
    sys.exit(main())
