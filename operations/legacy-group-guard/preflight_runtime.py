#!/usr/bin/env python3
"""Read-only preflight for the standalone old G-JUMP guard. Never prints token or URL."""
from pathlib import Path
import hashlib
import json
import os
import stat
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path("/home/gace/legacy-group-guard-deploy/operations/legacy-group-guard")
EXPECTED = {
    "guard.py": "f96374a68fc20d6c941d0f627ce3e795b6ce3fcf",
    "test_guard.py": "cd235fa397c98cc1f7779ed6aba2ff6347da597f",
    "compose.yaml": "ffd36804f8cfb95a928a152cbcf3935b3c249fec",
}
BOT_ID = 8086265383
CHAT_ID = -1002374817170


def blob_sha(path):
    data = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def api(token, method, values=None):
    from urllib.parse import urlencode
    endpoint = "https://api.telegram.org/bot" + token + "/" + method
    data = urlencode(values or {}).encode()
    req = urllib.request.Request(endpoint, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=9) as stream:
        response = json.load(stream)
    if not response.get("ok"):
        raise RuntimeError("TELEGRAM_API_REJECTED")
    return response["result"]


def run():
    print("========== GACE_RESULT_BEGIN ==========", flush=True)
    print("PROJECT=LegacyGuard")
    print("ACTION=SAFE_RUNTIME_PREFLIGHT")
    status = "FAIL"
    reason = "UNKNOWN"
    try:
        if not ROOT.is_dir():
            reason = "DEPLOY_ROOT_MISSING"
            return
        for name, expected in EXPECTED.items():
            if not (ROOT / name).is_file() or blob_sha(ROOT / name) != expected:
                reason = "SOURCE_MISMATCH_" + name.replace(".", "_")
                return
        print("SOURCE=PINNED_SHA_PASS")
        env_path = ROOT / ".env"
        if not env_path.is_file() or stat.S_IMODE(env_path.stat().st_mode) != 0o600:
            reason = "ENV_FILE_OR_MODE_INVALID"
            return
        config = {}
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            config[key.strip()] = val.strip().strip('"').strip("'")
        if not config.get("GUARD_BOT_TOKEN") or config.get("OLD_CHAT_ID") != str(CHAT_ID):
            reason = "ENV_SETTINGS_INVALID"
            return
        print("ENV=VALID_STRUCTURE")
        compose = subprocess.run(["docker", "compose", "config", "--quiet"],
                                 cwd=ROOT, capture_output=True, timeout=10)
        if compose.returncode:
            reason = "COMPOSE_CONFIG_FAILED"
            return
        print("COMPOSE=PASS")
        ps = subprocess.run(["docker", "ps", "--filter", "name=legacy-group-guard",
                             "--format", "{{.ID}}"], capture_output=True, timeout=10)
        if ps.returncode:
            reason = "DOCKER_LIST_FAILED"
            return
        count = len(ps.stdout.decode().splitlines())
        print("MATCHING_RUNNING_CONTAINERS=" + str(count))
        if count:
            reason = "GUARD_ALREADY_RUNNING"
            return
        state = ROOT / "state"
        print("STATE_DIR=" + ("PRESENT" if state.is_dir() else "MISSING"))
        if state.exists() and not state.is_dir():
            reason = "STATE_PATH_UNSAFE"
            return
        me = api(config["GUARD_BOT_TOKEN"], "getMe")
        if int(me["id"]) != BOT_ID:
            reason = "BOT_ID_MISMATCH"
            return
        print("BOT_ID=PASS")
        rights = api(config["GUARD_BOT_TOKEN"], "getChatMember",
                     {"chat_id": CHAT_ID, "user_id": BOT_ID})
        keys = ("can_delete_messages", "can_restrict_members", "can_change_info")
        if rights.get("status") != "administrator" or not all(rights.get(k) for k in keys):
            reason = "ADMIN_RIGHTS_INSUFFICIENT"
            return
        print("BOT_ADMIN_RIGHTS=PASS")
        webhook = api(config["GUARD_BOT_TOKEN"], "getWebhookInfo")
        print("WEBHOOK=" + ("CONFIGURED" if webhook.get("url") else "EMPTY"))
        print("PENDING_UPDATES=" + str(webhook.get("pending_update_count", "UNKNOWN")))
        # A configured webhook is expected at preflight, not a failure:
        # cutover is a separate owner-approved runtime step.
        status = "PASS"
        reason = "NONE"
    except (OSError, ValueError, KeyError, RuntimeError, urllib.error.URLError,
            subprocess.TimeoutExpired):
        reason = "PREFLIGHT_EXCEPTION_OR_NETWORK_FAILURE"
    finally:
        print("VERIFY=" + status)
        print("ERROR=" + reason)
        print("EXIT_CODE=" + ("0" if status == "PASS" else "1"))
        print("PROJECT_END=LegacyGuard")
        print("========== GACE_RESULT_END ==========", flush=True)


if __name__ == "__main__":
    run()
