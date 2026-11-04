#!/usr/bin/env python3
"""Single guarded cutover for OLD G-JUMP: build, preserve queue, switch and verify.

Changes only the pinned LegacyGuard Docker service and the retired webhook of
the pinned old Bot. Never calls drop_pending_updates=true and never logs token.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path("/home/gace/legacy-group-guard-deploy/operations/legacy-group-guard")
BOT_ID = 8086265383
CHAT_ID = -1002374817170
EXPECTED = {
    "guard.py": "f96374a68fc20d6c941d0f627ce3e795b6ce3fcf",
    "test_guard.py": "cd235fa397c98cc1f7779ed6aba2ff6347da597f",
    "Dockerfile": "f071887e583646e6cc6a02ca0c898bdeeddebd80",
    "compose.yaml": "9e82ec3bce0f5ddc1ab021cc0acbb65a3fa87a6d",
}
TITLE = "閉鎖したグループ"
DESCRIPTION = "このグループは閉鎖され一切の機能を停止しています"


class CutoverError(Exception):
    pass


def fail(message):
    raise CutoverError(message)


def blob_sha(path):
    raw = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def process(args, timeout=25):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=timeout)
    if result.returncode:
        fail("DOCKER_COMMAND_FAILED")
    return result.stdout.decode(errors="replace")


def api(token, method, data=None, timeout=12):
    url = "https://api.telegram.org/bot" + token + "/" + method
    payload = urllib.parse.urlencode(data or {}).encode()
    request = urllib.request.Request(url, data=payload, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            obj = json.load(response)
    except (urllib.error.URLError, TimeoutError):
        fail("TELEGRAM_API_NETWORK_ERROR_" + method)
    if not obj.get("ok"):
        fail("TELEGRAM_API_REJECTED_" + method)
    return obj["result"]


def read_env():
    target = ROOT / ".env"
    if not target.is_file() or stat.S_IMODE(target.stat().st_mode) != 0o600:
        fail("ENV_MISSING_OR_UNSAFE")
    config = {}
    for line in target.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        config[key.strip()] = val.strip().strip('"').strip("'")
    token = config.get("GUARD_BOT_TOKEN", "")
    if not token or config.get("OLD_CHAT_ID") != str(CHAT_ID):
        fail("ENV_SETTINGS_INVALID")
    return token


def once():
    if not ROOT.is_dir():
        fail("DEPLOY_ROOT_MISSING")
    for name, expected in EXPECTED.items():
        path = ROOT / name
        if not path.is_file() or blob_sha(path) != expected:
            fail("SOURCE_MISMATCH_" + name.replace(".", "_"))
    print("SOURCE=PINNED_PASS", flush=True)
    token = read_env()
    process(["docker", "compose", "config", "--quiet"], timeout=15)
    # Never start two instances of this service.
    before = process(["docker", "compose", "ps", "--status", "running", "-q",
                      "legacy-group-guard"], timeout=15)
    if before.strip():
        fail("GUARD_ALREADY_RUNNING")
    state = ROOT / "state"
    if state.is_symlink() or (state.exists() and not state.is_dir()):
        fail("STATE_PATH_UNSAFE")
    if not state.exists():
        state.mkdir(mode=0o700)
    info = state.stat()
    if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (1000, 1000, 0o700):
        fail("STATE_OWNER_MODE_MISMATCH")
    state_file = state / "state.json"
    if state_file.exists():
        if state_file.is_symlink() or not state_file.is_file():
            fail("STATE_FILE_UNSAFE")
        saved = json.loads(state_file.read_text())
        if not isinstance(saved, dict) or not isinstance(saved.get("offset", 0), int):
            fail("STATE_FILE_INVALID")
    process(["docker", "compose", "build", "legacy-group-guard"], timeout=180)
    print("IMAGE_BUILD=PASS", flush=True)
    process(["docker", "compose", "run", "--rm", "--no-deps", "--entrypoint",
             "sh", "legacy-group-guard", "-c",
             "touch /state/.gace-write-check && rm /state/.gace-write-check"],
            timeout=40)
    print("STATE_WRITE=PASS", flush=True)
    me = api(token, "getMe")
    if me.get("id") != BOT_ID:
        fail("BOT_ID_MISMATCH")
    rights = api(token, "getChatMember", {"chat_id": CHAT_ID, "user_id": BOT_ID})
    if rights.get("status") != "administrator" or not all(rights.get(k) for k in
                    ("can_delete_messages", "can_restrict_members", "can_change_info")):
        fail("BOT_ADMIN_RIGHTS_MISSING")
    print("BOT_AND_RIGHTS=PASS", flush=True)
    webhook = api(token, "getWebhookInfo")
    url = webhook.get("url", "")
    if url:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != "ssh.inkognit.org":
            fail("WEBHOOK_OWNER_CHANGED_REFUSE")
        print("OLD_WEBHOOK=PINNED", flush=True)
        print("PENDING_BEFORE=" + str(webhook.get("pending_update_count", "UNKNOWN")), flush=True)
        # Explicitly preserve pending Telegram updates.
        if api(token, "deleteWebhook", {"drop_pending_updates": "false"}) is not True:
            fail("DELETE_WEBHOOK_NOT_CONFIRMED")
        print("WEBHOOK_DELETE=PASS_DROP_FALSE", flush=True)
    else:
        print("OLD_WEBHOOK=ALREADY_EMPTY", flush=True)
    if api(token, "getWebhookInfo").get("url"):
        fail("WEBHOOK_STILL_CONFIGURED")
    print("WEBHOOK_EMPTY=PASS", flush=True)
    process(["docker", "compose", "up", "-d", "--no-deps", "legacy-group-guard"], timeout=50)
    print("DOCKER_START=SUBMITTED", flush=True)
    # Bounded verification; do not read raw logs into the user-visible output.
    deadline = time.monotonic() + 32
    ready = False
    while time.monotonic() < deadline:
        running = process(["docker", "compose", "ps", "--status", "running",
                           "-q", "legacy-group-guard"], timeout=12).strip()
        if not running:
            fail("GUARD_CONTAINER_NOT_RUNNING")
        logs = process(["docker", "compose", "logs", "--no-color", "--tail", "80",
                        "legacy-group-guard"], timeout=12)
        if "Guard ready:" in logs:
            ready = True
            break
        if "Guard preflight refused" in logs:
            fail("GUARD_PREFLIGHT_REFUSED")
        time.sleep(2)
    if not ready:
        fail("GUARD_READY_LOG_TIMEOUT")
    print("GUARD_READY=PASS", flush=True)
    # Read-back the live group without disclosing message/user data.
    chat = api(token, "getChat", {"chat_id": CHAT_ID})
    if chat.get("title") != TITLE or chat.get("description") != DESCRIPTION:
        fail("LIVE_GROUP_TEXT_NOT_RESTORED")
    if chat.get("photo"):
        fail("LIVE_GROUP_PHOTO_STILL_PRESENT")
    perms = chat.get("permissions") or {}
    if any(perms.get(k) for k in ("can_send_messages", "can_send_photos",
                                   "can_send_videos", "can_invite_users")):
        fail("LIVE_GROUP_MEMBER_PERMISSIONS_OPEN")
    print("LIVE_GROUP_LOCK=PASS", flush=True)
    print("PENDING_AFTER=" + str(api(token, "getWebhookInfo").get("pending_update_count", "UNKNOWN")), flush=True)


def main():
    print("========== GACE_RESULT_BEGIN ==========", flush=True)
    print("PROJECT=LegacyGuard")
    print("ACTION=GUARD_CUTOVER_AND_RUNTIME_VERIFY")
    step = "NONE"
    try:
        once()
        step = "PASS"
        reason = "NONE"
    except (CutoverError, OSError, ValueError, KeyError, json.JSONDecodeError,
            subprocess.TimeoutExpired) as exc:
        reason = str(exc) if isinstance(exc, CutoverError) else "EXCEPTION_" + type(exc).__name__
        print("GUARD_RESULT=NOT_VERIFIED", flush=True)
    print("VERIFY=" + step)
    print("ERROR=" + reason)
    print("EXIT_CODE=" + ("0" if step == "PASS" else "1"))
    print("PROJECT_END=LegacyGuard")
    print("========== GACE_RESULT_END ==========", flush=True)
    return 0 if step == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
