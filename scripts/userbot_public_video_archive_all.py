#!/usr/bin/env python3
"""Archive ALL videos in ALL joined public broadcast channels using one resident Userbot.

No channel joins, Telegram login, additional Telegram client, arbitrary paths, or
G-drive data deletion. Process the Master-priority channel first, then others.
Keep per-channel progress records and let already completed files be reused.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from userbot_public_video_archive import (
    CHANNEL_NAME, STATE_ROOT, STORAGE, archive_all_channel, write_state,
)
from userbot_test_client import invoke

PRIMARY = "theGreatOldDaysofNipponGV"
CURRENT_UNIT = "gace-public-video-collect-retry-20261114.service"
SUMMARY = STATE_ROOT / "_all_joined.json"
LOCK_FILE = STATE_ROOT / "_all_joined.lock"


def write_summary(status: dict) -> None:
    write_state(SUMMARY, dict(status, updated_at=datetime.now(timezone.utc).isoformat()))


def current_worker_active() -> bool:
    result = subprocess.run(
        ["systemctl", "--user", "show", CURRENT_UNIT,
         "--property=ActiveState", "--value"],
        capture_output=True, text=True, timeout=10, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("PREVIOUS_WORKER_STATE_NOT_VERIFIED")
    return result.stdout.strip() in {"active", "activating"}


def catalog_channels(response: dict) -> list[dict]:
    if response.get("status") != "PASS" or not isinstance(response.get("channels"), list):
        raise RuntimeError("RESIDENT_PUBLIC_CHANNEL_CATALOG_UNAVAILABLE")
    seen = set()
    channels = []
    for item in response["channels"]:
        if not isinstance(item, dict) or item.get("isPublic") is not True:
            continue
        username = item.get("username")
        channel_id = item.get("id")
        if (not isinstance(username, str)
                or CHANNEL_NAME.fullmatch(username) is None
                or type(channel_id) is not int or channel_id <= 0):
            continue
        if channel_id in seen:
            continue
        seen.add(channel_id)
        channels.append({"id": channel_id, "username": username})
    channels.sort(key=lambda c: (c["username"].casefold() != PRIMARY.casefold(),
                                 c["username"].casefold()))
    return channels


async def archive_joined(call, update):
    status = {
        "status": "running", "channels_total": 0, "channels_completed": 0,
        "channels_failed": 0, "channels": [], "current_channel": None,
    }
    update(status)
    discovered = catalog_channels(await call("list_joined_public_channels"))
    status["channels_total"] = len(discovered)
    update(status)
    for channel in discovered:
        username = channel["username"]
        status["current_channel"] = username
        update(status)
        def per_channel(progress):
            path = STATE_ROOT / (username.casefold() + ".json")
            write_state(path, dict(progress, updated_at=datetime.now(timezone.utc).isoformat()))
        try:
            report = await archive_all_channel(call, username, per_channel)
            complete = report["status"] == "complete"
            status["channels_completed" if complete else "channels_failed"] += 1
            status["channels"].append({
                "id": channel["id"], "username": username, "status": report["status"],
                "discovered": report["discovered"], "saved": report["saved"],
                "already_present": report["already_present"], "failed": report["failed"],
                "scanned": report["scanned"],
            })
        except Exception as exc:
            status["channels_failed"] += 1
            status["channels"].append({
                "id": channel["id"], "username": username,
                "status": "blocked", "error": type(exc).__name__,
            })
        update(status)
    status["current_channel"] = None
    status["status"] = "complete" if not status["channels_failed"] else "partial_failure"
    update(status)
    return status


async def main_async():
    if not STORAGE.is_dir() or STORAGE.is_symlink():
        raise RuntimeError("GSERVER_STORAGE_UNAVAILABLE")
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    if STATE_ROOT.is_symlink() or STATE_ROOT.resolve().parent != (STORAGE / "public_channel_videos").resolve():
        raise RuntimeError("ARCHIVE_STATE_INVALID")
    # Existing 3-video job predates this lock. Wait before touching its files.
    while current_worker_active():
        write_summary({"status": "waiting_previous_worker",
                       "previous_unit": CURRENT_UNIT})
        await asyncio.sleep(20)
    import fcntl
    with LOCK_FILE.open("a+b") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("PUBLIC_VIDEO_ARCHIVE_ALREADY_RUNNING") from exc
        result = await archive_joined(invoke, write_summary)
    print("ALL_JOINED_ARCHIVE_STATUS=" + result["status"], flush=True)
    print("ALL_JOINED_CHANNELS=" + str(result["channels_total"]), flush=True)
    print("ALL_JOINED_COMPLETED_CHANNELS=" + str(result["channels_completed"]), flush=True)
    return 0 if result["status"] == "complete" else 1


def main():
    try:
        return asyncio.run(main_async())
    except Exception as exc:
        write_summary({"status": "blocked", "error": type(exc).__name__})
        print("ALL_JOINED_ARCHIVE_STATUS=BLOCKED", flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
