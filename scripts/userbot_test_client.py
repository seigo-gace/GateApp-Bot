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


async def invoke(action: str) -> dict:
    if not SOCKET_PATH.exists() or not SOCKET_PATH.is_socket():
        raise RuntimeError("RESIDENT_USERBOT_IPC_NOT_AVAILABLE")
    sockstat = SOCKET_PATH.stat()
    if sockstat.st_uid != os.getuid() or stat.S_IMODE(sockstat.st_mode) != 0o600:
        raise RuntimeError("RESIDENT_USERBOT_IPC_PERMISSIONS_INVALID")
    reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(str(SOCKET_PATH)), 5)
    try:
        request_id = uuid.uuid4().hex
        writer.write((json.dumps({"request_id": request_id, "action": action}) + "\n").encode())
        await writer.drain()
        reply = await asyncio.wait_for(reader.readline(), 40)
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
    args = parser.parse_args()
    try:
        result = asyncio.run(invoke(args.action))
        if result.get("status") != "PASS":
            print("USERBOT_TEST_RESULT=FAIL")
            print("USERBOT_TEST_ERROR=" + re.sub(r"[^A-Z0-9_]", "_", str(result.get("error", "CONTRACT_MISMATCH")).upper())[:128])
            return 1
        print("USERBOT_TEST_RESULT=PASS")
        print("USERBOT_TEST_ACTION=" + args.action)
        if "row_sizes" in result:
            print("USERBOT_TEST_MENU_ROWS=" + ",".join(map(str, result["row_sizes"])))
        return 0
    except Exception as exc:
        print("USERBOT_TEST_RESULT=BLOCKED")
        print("USERBOT_TEST_ERROR=" + type(exc).__name__)
        return 2


if __name__ == "__main__":
    sys.exit(main())
