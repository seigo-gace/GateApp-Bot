#!/usr/bin/env python3
"""Idempotent pinned Compose-only sync; no live Telegram action."""
import hashlib
import os
from pathlib import Path
import shutil
import stat
import sys
import urllib.request

ROOT = Path("/home/gace/legacy-group-guard-deploy/operations/legacy-group-guard")
OLD = "ffd36804f8cfb95a928a152cbcf3935b3c249fec"
NEW = "9e82ec3bce0f5ddc1ab021cc0acbb65a3fa87a6d"
URL = ("https://raw.githubusercontent.com/seigo-gace/GateApp-Bot/"
       "59c1dfcfa5bc9af0eafc394fb52490953a7bba69/"
       "operations/legacy-group-guard/compose.yaml")

def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

print("========== GACE_RESULT_BEGIN ==========", flush=True)
print("PROJECT=LegacyGuard")
print("ACTION=SAFE_COMPOSE_SYNC")
status = "FAIL"
reason = "UNKNOWN"
try:
    target = ROOT / "compose.yaml"
    state = ROOT / "state"
    if not ROOT.is_dir() or not target.is_file():
        reason = "SOURCE_MISSING"
    elif not state.is_dir() or state.is_symlink():
        reason = "STATE_MISSING_OR_UNSAFE"
    elif (state.stat().st_uid, state.stat().st_gid, stat.S_IMODE(state.stat().st_mode)) != (1000, 1000, 0o700):
        reason = "STATE_PERMISSIONS_CHANGED"
    else:
        old_bytes = target.read_bytes()
        current = blob(old_bytes)
        if current == NEW:
            print("SOURCE=ALREADY_CURRENT")
            status = "PASS"
            reason = "NONE"
        elif current != OLD:
            reason = "LOCAL_COMPOSE_CHANGED"
        else:
            with urllib.request.urlopen(URL, timeout=20) as result:
                new_bytes = result.read(16000)
            if blob(new_bytes) != NEW:
                reason = "REMOTE_HASH_MISMATCH"
            else:
                backup = ROOT / ("compose.yaml.bak-" + OLD[:8])
                staged = ROOT / ".compose.yaml.gace-new"
                if backup.exists() or staged.exists():
                    reason = "BACKUP_OR_STAGE_ALREADY_EXISTS"
                else:
                    with backup.open("xb") as output:
                        output.write(old_bytes)
                    with staged.open("xb") as output:
                        output.write(new_bytes)
                    os.chmod(staged, stat.S_IMODE(target.stat().st_mode))
                    os.replace(staged, target)
                    if blob(target.read_bytes()) != NEW:
                        reason = "POST_INSTALL_HASH_MISMATCH"
                    else:
                        status = "PASS"
                        reason = "NONE"
                        print("SOURCE=UPDATED_NON_ROOT_UID")
except (OSError, ValueError):
    reason = "IO_FAILURE"
finally:
    print("VERIFY=" + status)
    print("ERROR=" + reason)
    print("EXIT_CODE=" + ("0" if status == "PASS" else "1"))
    print("PROJECT_END=LegacyGuard")
    print("========== GACE_RESULT_END ==========", flush=True)
sys.exit(0 if status == "PASS" else 1)
