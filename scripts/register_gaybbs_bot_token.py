#!/usr/bin/env python3
"""Register one Telegram bot secret without exposing it in logs, argv or Git.

Designed for Master WSL terminal. Does not launch any bot or mutate Telegram.
"""
import getpass
import json
import os
from pathlib import Path
import re
import stat
import sys
import urllib.parse
import urllib.request

DEST = Path.home() / ".config" / "gace" / "tgtumbler" / "gaybbs-bot.env"
USERNAME = "gaybbs_bot"
LEGACY_GUARD_ID = 8086265383

def result(status, error):
    print("========== GACE_RESULT_BEGIN ==========")
    print("PROJECT=TGtumbler")
    print("ACTION=REGISTER_GAYBBS_BOT_TOKEN")
    print("BOT_USERNAME=@GayBBS_bot")
    print("TOKEN=" + ("STORED" if status == "PASS" else "NOT_STORED"))
    print("SECRET_PATH=" + str(DEST))
    print("VERIFY=" + status)
    print("ERROR=" + error)
    print("EXIT_CODE=" + ("0" if status == "PASS" else "1"))
    print("PROJECT_END=TGtumbler")
    print("========== GACE_RESULT_END ==========", flush=True)

def main():
    if DEST.is_symlink() or DEST.exists():
        result("FAIL", "SECRET_ALREADY_EXISTS_NO_OVERWRITE")
        return 1
    if DEST.parent.exists() and DEST.parent.is_symlink():
        result("FAIL", "SECRET_PARENT_SYMLINK")
        return 1
    try:
        # getpass talks to /dev/tty; the token is not a shell argument.
        token = getpass.getpass("新しい @GayBBS_bot のTokenを入力（非表示）: ").strip()
        if not re.fullmatch(r"[0-9]{7,15}:[A-Za-z0-9_-]{30,100}", token):
            result("FAIL", "TOKEN_FORMAT_INVALID")
            return 1
        req = urllib.request.Request(
            "https://api.telegram.org/bot" + token + "/getMe",
            data=b"", method="POST")
        with urllib.request.urlopen(req, timeout=15) as response:
            payload = json.load(response)
        info = payload.get("result") or {}
        if not payload.get("ok") or str(info.get("username", "")).lower() != USERNAME:
            result("FAIL", "BOT_USERNAME_NOT_MATCHED")
            return 1
        if int(info.get("id", 0)) == LEGACY_GUARD_ID:
            result("FAIL", "LEGACY_GUARD_TOKEN_REFUSED")
            return 1
        DEST.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(DEST.parent, 0o700)
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
        fd = os.open(DEST, flags, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write("BOT_TOKEN=" + token + "\n")
        except BaseException:
            DEST.unlink(missing_ok=True)
            raise
        if stat.S_IMODE(DEST.stat().st_mode) != 0o600:
            DEST.unlink(missing_ok=True)
            raise RuntimeError("UNSAFE_SECRET_FILE_PERMISSIONS")
        result("PASS", "NONE")
        return 0
    except (EOFError, KeyboardInterrupt):
        result("FAIL", "INPUT_CANCELLED")
    except Exception:
        # NEVER print exceptions: network errors can include the token URL.
        result("FAIL", "INPUT_NETWORK_OR_STORAGE_ERROR")
    return 1

if __name__ == "__main__":
    sys.exit(main())
