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


async def invoke(action: str, chat_id: int | None = None, message_id: int | None = None, topic_ids: list[int] | None = None, code: str | None = None) -> dict:
    if not SOCKET_PATH.exists() or not SOCKET_PATH.is_socket():
        raise RuntimeError("RESIDENT_USERBOT_IPC_NOT_AVAILABLE")
    sockstat = SOCKET_PATH.stat()
    if sockstat.st_uid != os.getuid() or stat.S_IMODE(sockstat.st_mode) != 0o600:
        raise RuntimeError("RESIDENT_USERBOT_IPC_PERMISSIONS_INVALID")
    reader, writer = await asyncio.wait_for(asyncio.open_unix_connection(str(SOCKET_PATH)), 5)
    try:
        request_id = uuid.uuid4().hex
        request = {"request_id": request_id, "action": action}
        if action == "link_inline_query_smoke":
            if (chat_id is not None or message_id is not None or topic_ids is not None
                    or not isinstance(code,str) or not re.fullmatch(r"[A-Za-z0-9_-]{24}",code)):
                raise ValueError("LINK_INLINE_CODE_INVALID")
            request["code"]=code
        elif action == "room_public_readback":
            if chat_id is None or message_id is None or topic_ids is not None:
                raise ValueError("ROOM_READ_TARGET_REQUIRED")
            request.update({"chat_id": chat_id, "message_id": message_id})
        elif action == "profile_topics_by_id":
            if (chat_id is not None or message_id is not None
                    or type(topic_ids) is not list or len(topic_ids) != 3
                    or any(type(v) is not int or not 1 <= v <= 2147483647 for v in topic_ids)):
                raise ValueError("PROFILE_TOPIC_IDS_INVALID")
            request["topic_ids"] = topic_ids
        elif chat_id is not None or message_id is not None or topic_ids is not None or code is not None:
            raise ValueError("ROOM_READ_TARGET_ONLY_FOR_READBACK")
        writer.write((json.dumps(request) + "\n").encode())
        await writer.drain()
        reply = await asyncio.wait_for(reader.readline(), 110 if action in {"room_public_post_smoke", "bug_report_delivery_smoke", "link_registration_smoke"} else 40)
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
    parser.add_argument("--code", help="link share code for bounded inline-only check")
    parser.add_argument("--chat-id", type=int)
    parser.add_argument("--message-id", type=int)
    parser.add_argument("--topic-ids", help="three validated DB thread IDs, area/video/gay order")
    args = parser.parse_args()
    try:
        topic_ids = None
        if args.topic_ids is not None:
            parts = args.topic_ids.split(",")
            if len(parts) != 3 or any(not re.fullmatch(r"[1-9][0-9]*", v) for v in parts):
                raise ValueError("PROFILE_TOPIC_IDS_INVALID")
            topic_ids = [int(v) for v in parts]
        result = asyncio.run(invoke(args.action, args.chat_id, args.message_id, topic_ids, args.code))
        if result.get("status") != "PASS":
            print("USERBOT_TEST_RESULT=FAIL")
            print("USERBOT_TEST_ERROR=" + re.sub(r"[^A-Z0-9_]", "_", str(result.get("error", "CONTRACT_MISMATCH")).upper())[:128])
            return 1
        print("USERBOT_TEST_RESULT=PASS")
        print("USERBOT_TEST_ACTION=" + args.action)
        if args.action == "bug_report_delivery_smoke":
            if not all(result.get(key) is True for key in (
                    "userbot_inbox_received", "receipt_visible", "input_deleted")):
                raise RuntimeError("USERBOT_REPORT_E2E_RESULT_INCOMPLETE")
            print("USERBOT_REPORT_INBOX=PASS")
            print("USERBOT_REPORT_RECEIPT=PASS")
            print("USERBOT_REPORT_INPUT_DELETE=PASS")
        if args.action == "link_inline_query_smoke":
            if result.get("inline_result_found") is not True:
                raise RuntimeError("LINK_INLINE_RESULT_NOT_FOUND")
            print("USERBOT_LINK_INLINE_QUERY=PASS")
        if args.action == "link_registration_smoke":
            if not all(result.get(key) is True for key in (
                    "link_editor_opened", "two_line_button_accepted",
                    "blue_selected", "preview_present", "registration_receipt")):
                raise RuntimeError("LINK_REGISTRATION_SMOKE_INCOMPLETE")
            print("USERBOT_LINK_REGISTRATION=PASS")
        if args.action == "link_button_smoke":
            if result.get("link_editor_opened") is not True:
                raise RuntimeError("LINK_BUTTON_SCREEN_NOT_OPENED")
            print("USERBOT_LINK_BUTTON=PASS")
        if args.action == "profile_button_smoke":
            if result.get("profile_editor_opened") is not True:
                raise RuntimeError("PROFILE_BUTTON_SCREEN_NOT_OPENED")
            print("USERBOT_PROFILE_BUTTON=PASS")
        if args.action == "profile_topics_by_id":
            topics = result.get("topics")
            if (type(topics) is not list or len(topics) != 3
                    or [x.get("board") for x in topics if type(x) is dict]
                    != ["area_bbs", "video_chat", "gay_board"]
                    or any(type(x) is not dict or x.get("found") is not True
                           for x in topics)):
                raise RuntimeError("VERIFIED_PROFILE_TOPIC_MISMATCH")
            print("USERBOT_PROFILE_TOPIC_IDS=ALL_THREE_CONFIRMED")
        if args.action == "profile_topics_readback":
            topics = result.get("topics")
            if (not isinstance(topics, list) or len(topics) != 3
                    or any(not isinstance(t, dict) or t.get("board") not in
                           {"area_bbs", "video_chat", "gay_board"}
                           or type(t.get("found")) is not bool
                           or (t["found"] and (type(t.get("thread_id")) is not int
                                                or t["thread_id"] <= 0))
                           for t in topics)):
                raise RuntimeError("PROFILE_TOPICS_CONTRACT_INVALID")
            print("USERBOT_PROFILE_TOPICS=" + json.dumps(
                topics, ensure_ascii=False, separators=(",", ":")))
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
