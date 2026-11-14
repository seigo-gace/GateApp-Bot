#!/usr/bin/env python3
"""Collect a bounded batch of videos through the existing resident Userbot IPC.

Never opens a Telegram session. Can be rerun: completed downloads are reused
by the resident download action; no Telegram posting or subscription changes.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from userbot_test_client import invoke


async def collect_once(call, *, channel_username=None, max_per_channel=20):
    if not 1 <= max_per_channel <= 50:
        raise ValueError("MAX_PER_CHANNEL_INVALID")
    result = await call("list_joined_public_channels")
    if result.get("status") != "PASS":
        raise RuntimeError("PUBLIC_CHANNEL_DISCOVERY_FAILED")
    channels = result.get("channels")
    if not isinstance(channels, list):
        raise RuntimeError("PUBLIC_CHANNEL_DISCOVERY_INVALID")
    counts = {"channels": 0, "videos_found": 0, "downloaded": 0, "already_present": 0, "failed": 0}
    for channel in channels:
        username = str(channel.get("username", "")).lstrip("@")
        if channel_username and username.casefold() != channel_username.lstrip("@").casefold():
            continue
        if channel.get("isPublic") is not True:
            continue
        counts["channels"] += 1
        channel_id = channel["id"]
        page = await call("list_channel_videos", channel_id=channel_id, limit=max_per_channel)
        if page.get("status") != "PASS" or not isinstance(page.get("videos"), list):
            counts["failed"] += 1
            continue
        for video in page["videos"]:
            counts["videos_found"] += 1
            try:
                saved = await call("download_channel_video", channel_id=channel_id,
                                   message_id=video["messageId"])
                if saved.get("status") != "PASS" or not saved.get("storageKey"):
                    counts["failed"] += 1
                elif saved.get("alreadyPresent") is True:
                    counts["already_present"] += 1
                else:
                    counts["downloaded"] += 1
            except Exception:
                counts["failed"] += 1
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel-username", help="Optional public channel filter, without joining it")
    parser.add_argument("--max-per-channel", type=int, default=20)
    args = parser.parse_args()
    try:
        result = asyncio.run(collect_once(invoke, channel_username=args.channel_username,
                                          max_per_channel=args.max_per_channel))
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0 if result["failed"] == 0 else 1
    except Exception as exc:
        print("PUBLIC_VIDEO_BATCH=BLOCKED")
        print("REASON=" + type(exc).__name__)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
