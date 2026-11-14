#!/usr/bin/env python3
"""Activate full public-video history IPC after the prior 3-video worker exits.

This is a deterministic, session-preserving code activation followed by a
single G-drive archive. It NEVER starts TelegramClient or alters credentials.
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import os
import subprocess
import tempfile
from pathlib import Path

from userbot_public_video_archive_all import (
    CURRENT_UNIT, main_async as archive_all_joined,
)

ROOT = Path(__file__).resolve().parent
TARGETS = {
    "actions": ROOT / "userbot_public_video_actions.py",
    "ipc": ROOT / "userbot_resident_ipc.py",
    "client": ROOT / "userbot_test_client.py",
    "archive": ROOT / "userbot_public_video_archive.py",
    "all": ROOT / "userbot_public_video_archive_all.py",
}

def run(*args: str, timeout=45) -> subprocess.CompletedProcess:
    return subprocess.run(list(args), check=True, timeout=timeout, capture_output=True, text=True)

def source(commit: str, relative: str) -> str:
    return run("git", "show", f"{commit}:scripts/{relative}").stdout

def exactly_once(data: str, before: str, after: str, label: str) -> str:
    if data.count(before) != 1:
        raise RuntimeError(f"ACTIVATION_{label}_ANCHOR_MISMATCH")
    return data.replace(before, after, 1)

def expected_page_function(source_text: str) -> str:
    tree = ast.parse(source_text)
    functions = [n for n in tree.body
                 if isinstance(n, ast.AsyncFunctionDef) and n.name == "channel_video_page"]
    if len(functions) != 1:
        raise RuntimeError("PAGINATION_SOURCE_MISSING")
    node = functions[0]
    return "\n".join(source_text.splitlines()[node.lineno-1:node.end_lineno]) + "\n"

def compose_updates(commit: str) -> dict[Path, bytes]:
    actions = TARGETS["actions"].read_text()
    ipc = TARGETS["ipc"].read_text()
    client = TARGETS["client"].read_text()
    if "async def channel_video_page(" in actions or '"list_channel_video_page"' in ipc:
        raise RuntimeError("PAGINATION_ALREADY_INSTALLED_REVIEW_FIRST")
    page = expected_page_function(source(commit, "userbot_public_video_actions.py"))
    actions += "\n\n" + page
    ipc = exactly_once(
        ipc, '"download_channel_video_step"})',
        '"download_channel_video_step", "list_channel_video_page"})',
        "IPC_ACTION",
    )
    ipc = exactly_once(
        ipc, '"request_id", "action", "channel_id", "message_id", "limit"}',
        '"request_id", "action", "channel_id", "message_id", "limit", "before_message_id"}',
        "IPC_FIELDS",
    )
    ipc = exactly_once(
        ipc,
        '{"list_joined_public_channels", "list_channel_videos", "download_channel_video", "download_channel_video_step"}:',
        '{"list_joined_public_channels", "list_channel_videos", "download_channel_video", "download_channel_video_step", "list_channel_video_page"}:',
        "IPC_CASES",
    )
    ipc = exactly_once(
        ipc,
        "from userbot_public_video_actions import joined_public_channels, channel_videos, download_video",
        "from userbot_public_video_actions import joined_public_channels, channel_videos, download_video, channel_video_page",
        "IPC_IMPORT",
    )
    anchor = '        if set(request) != required | {"channel_id", "message_id"}: raise ValueError("REQUEST_SHAPE_INVALID")'
    extension = (
        '        if action == "list_channel_video_page":\n'
        '            if set(request) not in (required | {"channel_id"}, required | {"channel_id", "before_message_id"}):\n'
        '                raise ValueError("REQUEST_SHAPE_INVALID")\n'
        '            page = await channel_video_page(client, request["channel_id"], request.get("before_message_id"))\n'
        '            return {"request_id": request_id, "action": action, "status": "PASS", **page}\n'
        + anchor
    )
    ipc = exactly_once(ipc, anchor, extension, "IPC_DISPATCH")
    ipc = exactly_once(ipc, "MAX_RESPONSE_BYTES = 65536", "MAX_RESPONSE_BYTES = 262144", "IPC_RESPONSE_SIZE")
    client = exactly_once(
        client, "limit: int | None = None) -> dict:",
        "limit: int | None = None, before_message_id: int | None = None) -> dict:",
        "CLIENT_SIGNATURE",
    )
    client = exactly_once(
        client, '        if limit is not None: request["limit"] = limit',
        '        if limit is not None: request["limit"] = limit\n'
        '        if before_message_id is not None: request["before_message_id"] = before_message_id',
        "CLIENT_REQUEST",
    )
    client = exactly_once(
        client, "asyncio.open_unix_connection(str(SOCKET_PATH))",
        "asyncio.open_unix_connection(str(SOCKET_PATH), limit=262144)",
        "CLIENT_BUFFER",
    )
    client = exactly_once(
        client, '    parser.add_argument("--limit", type=int)',
        '    parser.add_argument("--limit", type=int)\n    parser.add_argument("--before-message-id", type=int)',
        "CLIENT_CLI",
    )
    client = exactly_once(
        client, "args.channel_id, args.message_id, args.limit))",
        "args.channel_id, args.message_id, args.limit, args.before_message_id))",
        "CLIENT_CALL",
    )
    updated = {
        TARGETS["actions"]: actions.encode(),
        TARGETS["ipc"]: ipc.encode(),
        TARGETS["client"]: client.encode(),
        TARGETS["archive"]: source(commit, "userbot_public_video_archive.py").encode(),
        TARGETS["all"]: source(commit, "userbot_public_video_archive_all.py").encode(),
    }
    for path, blob in updated.items():
        compile(blob.decode(), str(path), "exec")
    return updated

def replace_atomic(path: Path, content: bytes) -> None:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("SOURCE_PATH_UNEXPECTED")
    fd, name = tempfile.mkstemp(prefix=".video-update-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, path.stat().st_mode & 0o777)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

async def activate(commit: str) -> None:
    # The previous three-video job can be hours long. Never compete for one partial.
    while True:
        result = subprocess.run(
            ["systemctl", "--user", "is-active", CURRENT_UNIT],
            capture_output=True, text=True, timeout=10,
        )
        if result.stdout.strip() not in {"active", "activating"}:
            break
        print("ARCHIVE_ACTIVATION=WAITING_EXISTING_DOWNLOAD", flush=True)
        await asyncio.sleep(30)
    if run("systemctl", "--user", "is-active",
           "gace-userbot-verify.service").stdout.strip() != "active":
        raise RuntimeError("RESIDENT_SERVICE_NOT_ACTIVE")
    existing = {path: path.read_bytes() for path in TARGETS.values()}
    updated = compose_updates(commit)
    try:
        for path, content in updated.items():
            replace_atomic(path, content)
        run("systemctl", "--user", "restart", "gace-userbot-verify.service", timeout=45)
        authorized = False
        for _ in range(15):
            await asyncio.sleep(2)
            if subprocess.run(["python3", str(TARGETS["client"]), "health"],
                              capture_output=True, timeout=12).returncode == 0:
                authorized = True
                break
        if not authorized:
            raise RuntimeError("RESIDENT_HEALTH_AFTER_ACTIVATION_FAILED")
    except Exception:
        for path, content in existing.items():
            replace_atomic(path, content)
        # Existing code and protected session stay unchanged.
        run("systemctl", "--user", "restart", "gace-userbot-verify.service", timeout=45)
        raise
    print("ALL_JOINED_IPC_ACTIVATED=PASS", flush=True)
    result = await archive_all_joined()
    if result:
        raise RuntimeError("ALL_JOINED_COLLECTION_PARTIAL_FAILURE")

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    if len(args.source_commit) != 40 or any(c not in "0123456789abcdef" for c in args.source_commit):
        parser.error("Source commit must be a full verified SHA")
    try:
        asyncio.run(activate(args.source_commit))
        return 0
    except Exception as exc:
        print("ALL_JOINED_WORKER_FAILURE=" + type(exc).__name__, flush=True)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
