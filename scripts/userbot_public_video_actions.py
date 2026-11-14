#!/usr/bin/env python3
"""Public video discovery/download through the sole resident Telethon client.

Read-only discovery; downloads only to the existing Gserver G-drive. No login,
forwarding, posting or source-channel membership changes.
"""
from __future__ import annotations

import os
from pathlib import Path

STORAGE_ROOT = Path("/mnt/g/GserverStorage")
VIDEO_ROOT = STORAGE_ROOT / "public_channel_videos"


async def joined_public_channels(client):
    result = []
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        username = getattr(entity, "username", None)
        if not getattr(dialog, "is_channel", False) or not username:
            continue
        if getattr(entity, "megagroup", False):
            continue
        result.append({
            "id": int(entity.id), "username": username,
            "title": str(getattr(entity, "title", ""))[:256], "isPublic": True
        })
    return result


async def joined_channel(client, channel_id):
    if type(channel_id) is not int or channel_id <= 0:
        raise ValueError("CHANNEL_ID_INVALID")
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if (getattr(dialog, "is_channel", False)
                and not getattr(entity, "megagroup", False)
                and getattr(entity, "username", None)
                and getattr(entity, "id", None) == channel_id):
            return entity
    raise ValueError("PUBLIC_JOINED_CHANNEL_NOT_FOUND")


async def channel_videos(client, channel_id, limit):
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("VIDEO_LIMIT_INVALID")
    entity = await joined_channel(client, channel_id)
    result = []
    # Limit is the number of video results, not the number of posts scanned.
    async for message in client.iter_messages(entity, limit=min(500, limit * 10)):
        if not message.video:
            continue
        result.append({
            "messageId": int(message.id), "kind": "video",
            "date": message.date.isoformat() if message.date else None,
            "caption": (message.raw_text or "")[:4096],
            "fileUniqueId": None,
        })
        if len(result) >= limit:
            break
    return result


async def download_video(client, channel_id, message_id):
    if type(message_id) is not int or message_id <= 0:
        raise ValueError("MESSAGE_ID_INVALID")
    entity = await joined_channel(client, channel_id)
    message = await client.get_messages(entity, ids=message_id)
    if message is None or not message.video:
        raise ValueError("SOURCE_VIDEO_NOT_FOUND")

    if not STORAGE_ROOT.is_dir() or STORAGE_ROOT.is_symlink():
        raise RuntimeError("GSERVER_STORAGE_NOT_MOUNTED")
    root = VIDEO_ROOT / str(channel_id)
    root.mkdir(parents=True, exist_ok=True)
    if root.resolve().parent != VIDEO_ROOT.resolve():
        raise RuntimeError("STORAGE_PATH_INVALID")

    stem = str(message_id)
    # Reuse only a completed local file. Never treat a partial as downloaded.
    existing = [p for p in root.glob(stem + ".*")
                if p.is_file() and p.suffix != ".partial" and p.stat().st_size > 0]
    if existing:
        return {"storageKey": str(existing[0]), "alreadyPresent": True}

    # Telethon may add the source extension. Isolate one download prefix and
    # atomically publish the result after a non-empty payload exists.
    prefix = root / (stem + ".partial")
    downloaded = await client.download_media(message, file=str(prefix))
    if not downloaded:
        raise RuntimeError("DOWNLOAD_NOT_CONFIRMED")
    temp = Path(downloaded)
    if temp.parent.resolve() != root.resolve() or not temp.is_file():
        raise RuntimeError("DOWNLOAD_OUTPUT_INVALID")
    if temp.stat().st_size == 0:
        temp.unlink(missing_ok=True)
        raise RuntimeError("DOWNLOAD_EMPTY")
    extension = temp.suffix.lower()
    if extension in ("", ".partial"):
        extension = ".mp4"
    destination = root / (stem + extension)
    os.replace(temp, destination)
    return {"storageKey": str(destination), "alreadyPresent": False}
