#!/usr/bin/env python3
"""One-shot public-channel video archive via the existing resident Userbot IPC.

Run as a transient, non-login job. State stays on the existing G-drive; the
resident service remains the only Telegram session owner. Re-running reuses
already completed files, never posts messages, and never joins channels.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from userbot_test_client import invoke

STORAGE = Path("/mnt/g/GserverStorage")
STATE_ROOT = STORAGE / "public_channel_videos" / "_jobs"
CHANNEL_NAME = re.compile(r"^[A-Za-z0-9_]{5,32}$")


def write_state(path: Path, value: dict) -> None:
    if not STORAGE.is_dir() or STORAGE.is_symlink():
        raise RuntimeError("GSERVER_STORAGE_UNAVAILABLE")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.resolve() != STATE_ROOT.resolve():
        raise RuntimeError("ARCHIVE_STATE_PATH_INVALID")
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    fd, temporary = tempfile.mkstemp(prefix=".progress-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


async def archive_channel(call, channel_username: str, limit: int, on_progress):
    if not isinstance(channel_username, str) or not CHANNEL_NAME.fullmatch(channel_username):
        raise ValueError("PUBLIC_CHANNEL_USERNAME_INVALID")
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("ARCHIVE_LIMIT_INVALID")

    catalog = await call("list_joined_public_channels")
    if catalog.get("status") != "PASS" or not isinstance(catalog.get("channels"), list):
        raise RuntimeError("RESIDENT_CHANNEL_LIST_FAILED")
    matches = [c for c in catalog["channels"] if c.get("isPublic") is True
               and str(c.get("username", "")).casefold() == channel_username.casefold()]
    if len(matches) != 1:
        raise RuntimeError("TARGET_JOINED_PUBLIC_CHANNEL_NOT_FOUND")
    channel_id = matches[0]["id"]

    response = await call("list_channel_videos", channel_id=channel_id, limit=limit)
    if response.get("status") != "PASS" or not isinstance(response.get("videos"), list):
        raise RuntimeError("PUBLIC_VIDEO_LIST_FAILED")

    state = {
        "status": "running", "channel_username": channel_username,
        "channel_id": channel_id, "discovered": len(response["videos"]),
        "saved": 0, "already_present": 0, "failed": 0, "completed": [],
        "last_message_id": None,
    }
    on_progress(state)
    for record in response["videos"]:
        message_id = record["messageId"]
        state["last_message_id"] = message_id
        on_progress(state)
        try:
            last_progress = -1
            while True:
                saved = await call("download_channel_video_step", channel_id=channel_id,
                                   message_id=message_id)
                if saved.get("status") != "PASS":
                    raise RuntimeError("DOWNLOAD_STEP_FAILED")
                if saved.get("completed") is True and saved.get("storageKey"):
                    state["already_present" if saved.get("alreadyPresent") is True else "saved"] += 1
                    state["completed"].append(message_id)
                    break
                position, total = saved.get("progressBytes"), saved.get("sizeBytes")
                if (type(position) is not int or type(total) is not int
                        or position <= last_progress or position > total):
                    raise RuntimeError("DOWNLOAD_STEP_STALLED")
                last_progress = position
                state["current_progress_bytes"] = position
                state["current_total_bytes"] = total
                on_progress(state)
            state.pop("current_progress_bytes", None)
            state.pop("current_total_bytes", None)
        except Exception:
            state["failed"] += 1
        on_progress(state)

    state["status"] = "complete" if not state["failed"] else "partial_failure"
    on_progress(state)
    return state


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel-username", required=True)
    parser.add_argument("--recent-limit", type=int, default=50)
    args = parser.parse_args()
    if not CHANNEL_NAME.fullmatch(args.channel_username):
        parser.error("Invalid channel username")
    progress = STATE_ROOT / (args.channel_username.lower() + ".json")
    def update(value):
        value = dict(value, updated_at=datetime.now(timezone.utc).isoformat())
        write_state(progress, value)
    try:
        result = asyncio.run(archive_channel(invoke, args.channel_username,
                                             args.recent_limit, update))
        print("VIDEO_ARCHIVE_STATUS=" + result["status"])
        print("VIDEO_ARCHIVE_SAVED=" + str(result["saved"]))
        print("VIDEO_ARCHIVE_ALREADY_PRESENT=" + str(result["already_present"]))
        print("VIDEO_ARCHIVE_FAILED=" + str(result["failed"]))
        return 0 if not result["failed"] else 1
    except Exception as exc:
        update({"status": "blocked", "error": type(exc).__name__})
        print("VIDEO_ARCHIVE_STATUS=BLOCKED")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
