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


CHUNK_BYTES = 512 * 1024


async def _remote_first_chunk(client, media, file_size):
    stream = client.iter_download(media, offset=0, limit=1, chunk_size=CHUNK_BYTES,
                                  request_size=CHUNK_BYTES, file_size=file_size)
    try:
        return bytes(await stream.__anext__())
    except StopAsyncIteration as exc:
        raise RuntimeError("REMOTE_VIDEO_PREFIX_UNAVAILABLE") from exc
    finally:
        close = getattr(stream, "close", None)
        if close is not None:
            await close()


async def download_video(client, channel_id, message_id):
    """Resume only a verified prefix; never overwrite a valid partial file."""
    if type(message_id) is not int or message_id <= 0:
        raise ValueError("MESSAGE_ID_INVALID")
    entity = await joined_channel(client, channel_id)
    message = await client.get_messages(entity, ids=message_id)
    if message is None or not message.video:
        raise ValueError("SOURCE_VIDEO_NOT_FOUND")
    file_size = getattr(message.video, "size", None)
    if type(file_size) is not int or file_size <= 0:
        raise RuntimeError("SOURCE_VIDEO_SIZE_UNAVAILABLE")

    if not STORAGE_ROOT.is_dir() or STORAGE_ROOT.is_symlink():
        raise RuntimeError("GSERVER_STORAGE_NOT_MOUNTED")
    if VIDEO_ROOT.is_symlink() or (VIDEO_ROOT.exists() and
                                   VIDEO_ROOT.resolve().parent != STORAGE_ROOT.resolve()):
        raise RuntimeError("STORAGE_PATH_INVALID")
    root = VIDEO_ROOT / str(channel_id)
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink() or root.resolve().parent != VIDEO_ROOT.resolve():
        raise RuntimeError("STORAGE_PATH_INVALID")

    stem = str(message_id)
    source_ext = str(getattr(getattr(message, "file", None), "ext", "") or "").lower()
    if source_ext not in {".mp4", ".mov", ".mkv", ".webm", ".avi"}:
        source_ext = ".bin"
    destination = root / (stem + source_ext)
    partial = root / (stem + ".partial")

    # An existing destination is trusted only if its size matches the source.
    # Never silently replace conflicting or unknown completed files.
    for found in root.glob(stem + ".*"):
        if found == partial:
            continue
        if found.is_symlink() or not found.is_file() or found != destination:
            raise RuntimeError("EXISTING_VIDEO_CONFLICT")
        if found.stat().st_size != file_size:
            raise RuntimeError("EXISTING_VIDEO_SIZE_MISMATCH")
        return {"storageKey": str(found), "alreadyPresent": True,
                "sizeBytes": file_size, "verifiedSize": True}

    if partial.is_symlink() or (partial.exists() and not partial.is_file()):
        raise RuntimeError("PARTIAL_VIDEO_PATH_INVALID")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > file_size:
        raise RuntimeError("PARTIAL_LARGER_THAN_SOURCE")

    # A pre-existing partial may have originated from another source or an old
    # message revision. Verify the first block from Telegram before resuming.
    if offset:
        first = await _remote_first_chunk(client, message.media, file_size)
        if not first:
            raise RuntimeError("REMOTE_VIDEO_PREFIX_UNAVAILABLE")
        with partial.open("rb") as handle:
            local = handle.read(min(len(first), offset))
        if local != first[:len(local)] or len(local) != min(len(first), offset):
            raise RuntimeError("PARTIAL_PREFIX_MISMATCH")

    if offset < file_size:
        with partial.open("ab") as handle:
            async for chunk in client.iter_download(
                message.media, offset=offset, request_size=CHUNK_BYTES,
                chunk_size=CHUNK_BYTES, file_size=file_size
            ):
                block = bytes(chunk)
                if not block or offset + len(block) > file_size:
                    raise RuntimeError("VIDEO_CHUNK_INVALID")
                handle.write(block)
                offset += len(block)
                if offset == file_size:
                    break
            handle.flush()
            os.fsync(handle.fileno())

    if not partial.is_file() or partial.stat().st_size != file_size:
        raise RuntimeError("DOWNLOAD_INCOMPLETE")
    if destination.exists() or destination.is_symlink():
        raise RuntimeError("EXISTING_VIDEO_CONFLICT")
    os.replace(partial, destination)
    return {"storageKey": str(destination), "alreadyPresent": False,
            "sizeBytes": file_size, "verifiedSize": True}
