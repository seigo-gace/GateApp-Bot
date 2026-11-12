#!/usr/bin/env python3
"""Force and verify ONLY the already approved old group's default member lockdown.

Non-secret bounded output. Does not stop/change the running polling container.
"""
import json
from pathlib import Path
import stat
import sys
import time
import urllib.parse
import urllib.request

ROOT = Path("/home/gace/legacy-group-guard-deploy/operations/legacy-group-guard")
CHAT_ID = -1002374817170
BOT_ID = 8086265383
PERMISSIONS = [
    "can_send_messages", "can_send_audios", "can_send_documents",
    "can_send_photos", "can_send_videos", "can_send_video_notes",
    "can_send_voice_notes", "can_send_polls", "can_send_other_messages",
    "can_add_web_page_previews", "can_change_info", "can_invite_users",
    "can_pin_messages", "can_manage_topics",
]


def api(token, method, fields=None):
    url = "https://api.telegram.org/bot" + token + "/" + method
    data = urllib.parse.urlencode(fields or {}).encode()
    with urllib.request.urlopen(urllib.request.Request(url, data=data, method="POST"), timeout=12) as r:
        result = json.load(r)
    if not result.get("ok"):
        raise RuntimeError("API_REJECTED_" + method + "_" + str(result.get("error_code")))
    return result["result"]


def main():
    print("========== GACE_RESULT_BEGIN ==========", flush=True)
    print("PROJECT=LegacyGuard")
    print("ACTION=FORCE_MEMBER_LOCK_AND_READBACK")
    passed = False
    error = "UNKNOWN"
    try:
        env = ROOT / ".env"
        if not env.is_file() or stat.S_IMODE(env.stat().st_mode) != 0o600:
            raise RuntimeError("ENV_NOT_SAFE")
        conf = {}
        for row in env.read_text().splitlines():
            row = row.strip()
            if row and not row.startswith("#") and "=" in row:
                key, value = row.split("=", 1)
                conf[key.strip()] = value.strip().strip('"').strip("'")
        token = conf.get("GUARD_BOT_TOKEN", "")
        if not token or conf.get("OLD_CHAT_ID") != str(CHAT_ID):
            raise RuntimeError("ENV_IDENTITY_INVALID")
        me = api(token, "getMe")
        if me.get("id") != BOT_ID:
            raise RuntimeError("BOT_ID_MISMATCH")
        member = api(token, "getChatMember", {"chat_id": CHAT_ID, "user_id": BOT_ID})
        if member.get("status") != "administrator" or member.get("can_restrict_members") is not True:
            raise RuntimeError("BOT_RIGHTS_MISSING")
        if api(token, "getWebhookInfo").get("url"):
            raise RuntimeError("WEBHOOK_RECONFIGURED")
        chat = api(token, "getChat", {"chat_id": CHAT_ID})
        if chat.get("id") != CHAT_ID or chat.get("type") != "supergroup":
            raise RuntimeError("CHAT_ID_OR_TYPE_MISMATCH")
        before = chat.get("permissions") or {}
        print("BEFORE_ENABLED=" + ",".join(k for k in PERMISSIONS if before.get(k) is True), flush=True)
        locked = {k: False for k in PERMISSIONS}
        result = api(token, "setChatPermissions", {
            "chat_id": str(CHAT_ID),
            "permissions": json.dumps(locked, separators=(",", ":")),
            "use_independent_chat_permissions": "true",
        })
        if result is not True:
            raise RuntimeError("SET_CHAT_PERMISSIONS_FALSE")
        print("SET_CHAT_PERMISSIONS=PASS", flush=True)
        after = api(token, "getChat", {"chat_id": CHAT_ID}).get("permissions") or {}
        still_enabled = [k for k in PERMISSIONS if after.get(k) is True]
        print("AFTER_ENABLED=" + (",".join(still_enabled) or "NONE"), flush=True)
        if still_enabled:
            raise RuntimeError("LOCK_READBACK_STILL_OPEN")
        passed = True
        error = "NONE"
    except Exception as exc:
        error = str(exc) if isinstance(exc, RuntimeError) else "EXCEPTION_" + type(exc).__name__
    print("VERIFY=" + ("PASS" if passed else "FAIL"))
    print("ERROR=" + error)
    print("EXIT_CODE=" + ("0" if passed else "1"))
    print("PROJECT_END=LegacyGuard")
    print("========== GACE_RESULT_END ==========", flush=True)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
