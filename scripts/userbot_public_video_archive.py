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


async def download_one(call, channel_id, message_id, state, on_progress):
    last_progress = -1
    while True:
        saved = await call("download_channel_video_step", channel_id=channel_id,
                           message_id=message_id)
        if saved.get("status") != "PASS":
            raise RuntimeError("DOWNLOAD_STEP_FAILED")
        if saved.get("completed") is True and saved.get("storageKey"):
            state.pop("current_progress_bytes", None)
            state.pop("current_total_bytes", None)
            return saved.get("alreadyPresent") is True
        position, total = saved.get("progressBytes"), saved.get("sizeBytes")
        if (type(position) is not int or type(total) is not int
                or position <= last_progress or position > total):
            raise RuntimeError("DOWNLOAD_STEP_STALLED")
        last_progress = position
        state["current_progress_bytes"] = position
        state["current_total_bytes"] = total
        on_progress(state)


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
        "last_message_id": None, "failures": [],
    }
    on_progress(state)
    for record in response["videos"]:
        message_id = record["messageId"]
        state["last_message_id"] = message_id
        on_progress(state)
        try:
            for attempt in range(1, 4):
                try:
                    present = await download_one(call, channel_id, message_id, state, on_progress)
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    # The resident socket is not reauthenticated or restarted.
                    await asyncio.sleep(attempt)
            state["already_present" if present else "saved"] += 1
            state["completed"].append(message_id)
        except Exception as exc:
            state["failed"] += 1
            # Preserve bounded diagnostic codes, never Telegram dialogs or secrets.
            code = str(exc) if type(exc) is RuntimeError and str(exc).isupper() else type(exc).__name__
            state["failures"].append({"messageId": message_id, "error": code[:96]})
        on_progress(state)

    state["status"] = "complete" if not state["failed"] else "partial_failure"
    on_progress(state)
    return state


async def archive_all_channel(call, channel_username: str, on_progress):
    """Iterate every page of the joined public channel, including video-free gaps."""
    if not isinstance(channel_username, str) or not CHANNEL_NAME.fullmatch(channel_username):
        raise ValueError("PUBLIC_CHANNEL_USERNAME_INVALID")
    catalog = await call("list_joined_public_channels")
    if catalog.get("status") != "PASS" or not isinstance(catalog.get("channels"), list):
        raise RuntimeError("RESIDENT_CHANNEL_LIST_FAILED")
    channels = [c for c in catalog["channels"] if c.get("isPublic") is True
                and str(c.get("username", "")).casefold() == channel_username.casefold()]
    if len(channels) != 1:
        raise RuntimeError("TARGET_JOINED_PUBLIC_CHANNEL_NOT_FOUND")
    channel_id = channels[0]["id"]
    state = {"status": "running", "channel_id": channel_id, "channel_username": channel_username,
             "scanned": 0, "discovered": 0, "saved": 0, "already_present": 0,
             "failed": 0, "last_message_id": None, "cursor": None, "failures": []}
    on_progress(state)
    cursor = None
    while True:
        args = {"channel_id": channel_id}
        if cursor is not None:
            args["before_message_id"] = cursor
        page = await call("list_channel_video_page", **args)
        if page.get("status") != "PASS" or not isinstance(page.get("videos"), list):
            raise RuntimeError("PUBLIC_VIDEO_PAGE_FAILED")
        scanned = page.get("scanned")
        if type(scanned) is not int or not 0 <= scanned <= 500:
            raise RuntimeError("PUBLIC_VIDEO_PAGE_SCAN_INVALID")
        state["scanned"] += scanned
        for video in page["videos"]:
            message_id = video.get("messageId")
            if type(message_id) is not int or message_id <= 0:
                raise RuntimeError("PUBLIC_VIDEO_PAGE_MESSAGE_INVALID")
            state["discovered"] += 1
            state["last_message_id"] = message_id
            on_progress(state)
            try:
                for attempt in range(1, 4):
                    try:
                        present = await download_one(call, channel_id, message_id, state, on_progress)
                        break
                    except Exception:
                        if attempt == 3:
                            raise
                        await asyncio.sleep(attempt)
                state["already_present" if present else "saved"] += 1
            except Exception:
                state["failed"] += 1
            on_progress(state)
        next_cursor = page.get("nextBeforeMessageId")
        if next_cursor is None:
            break
        if (type(next_cursor) is not int or next_cursor <= 0
                or cursor is not None and next_cursor >= cursor):
            raise RuntimeError("PUBLIC_VIDEO_CURSOR_NOT_ADVANCING")
        cursor = next_cursor
        state["cursor"] = cursor
        on_progress(state)
    state["status"] = "complete" if state["failed"] == 0 else "partial_failure"
    on_progress(state)
    return state


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel-username", required=True)
    parser.add_argument("--recent-limit", type=int, default=50)
    parser.add_argument("--all", action="store_true", help="Continue page-by-page until channel history ends")
    args = parser.parse_args()
    if not CHANNEL_NAME.fullmatch(args.channel_username):
        parser.error("Invalid channel username")
    progress = STATE_ROOT / (args.channel_username.lower() + ".json")
    def update(value):
        value = dict(value, updated_at=datetime.now(timezone.utc).isoformat())
        write_state(progress, value)
    try:
        if args.all:
            result = asyncio.run(archive_all_channel(invoke, args.channel_username, update))
        else:
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
