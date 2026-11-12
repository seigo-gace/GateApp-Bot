#!/usr/bin/env python3
"""Prepare local Docker image and persistence; never start the Telegram guard."""
import hashlib
import os
from pathlib import Path
import stat
import subprocess
import sys

ROOT = Path("/home/gace/legacy-group-guard-deploy/operations/legacy-group-guard")
EXPECTED = {
    "guard.py": "f96374a68fc20d6c941d0f627ce3e795b6ce3fcf",
    "test_guard.py": "cd235fa397c98cc1f7779ed6aba2ff6347da597f",
    "compose.yaml": "9e82ec3bce0f5ddc1ab021cc0acbb65a3fa87a6d",
    "Dockerfile": "f071887e583646e6cc6a02ca0c898bdeeddebd80",
}


def git_blob(path):
    data = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def docker(*args, timeout=35):
    return subprocess.run(["docker", *args], cwd=ROOT,
                          capture_output=True, timeout=timeout).returncode == 0


def execute():
    print("========== GACE_RESULT_BEGIN ==========", flush=True)
    print("PROJECT=LegacyGuard")
    print("ACTION=BUILD_AND_PREPARE_STATE")
    status = "FAIL"
    reason = "UNKNOWN"
    try:
        if not ROOT.is_dir():
            reason = "ROOT_MISSING"
            return
        if any(not (ROOT / key).is_file() or git_blob(ROOT / key) != val
               for key, val in EXPECTED.items()):
            reason = "SOURCE_NOT_PINNED"
            return
        print("SOURCE=PINNED_PASS")
        env = ROOT / ".env"
        if not env.is_file() or stat.S_IMODE(env.stat().st_mode) != 0o600:
            reason = "ENV_MISSING_OR_UNSAFE"
            return
        if not docker("compose", "config", "--quiet", timeout=12):
            reason = "COMPOSE_CONFIG_FAILED"
            return
        ps = subprocess.run(["docker", "ps", "--filter",
                             "name=legacy-group-guard", "--format", "{{.ID}}"],
                            cwd=ROOT, capture_output=True, timeout=12)
        if ps.returncode or ps.stdout.strip():
            reason = "DOCKER_PS_FAILED_OR_GUARD_ALREADY_RUNNING"
            return
        state = ROOT / "state"
        if state.is_symlink() or (state.exists() and not state.is_dir()):
            reason = "STATE_PATH_UNSAFE"
            return
        if not state.exists():
            state.mkdir(mode=0o700)
            print("STATE_DIR=CREATED")
        else:
            print("STATE_DIR=EXISTS")
        # Building is offline relative to Telegram: no bot process is started.
        if not docker("compose", "build", "legacy-group-guard", timeout=150):
            reason = "IMAGE_BUILD_FAILED"
            return
        print("IMAGE_BUILD=PASS")
        # Docker Compose runs as the existing unprivileged host owner 1000:1000.
        # No privileged container and no host ownership mutation.
        info = state.stat()
        if info.st_uid != 1000 or info.st_gid != 1000 or stat.S_IMODE(info.st_mode) != 0o700:
            reason = "STATE_OWNER_OR_MODE_NOT_EXPECTED"
            return
        if not docker("compose", "run", "--rm", "--no-deps",
                      "--entrypoint", "sh", "legacy-group-guard", "-c",
                      "touch /state/.gace-write-check && rm /state/.gace-write-check",
                      timeout=35):
            reason = "STATE_WRITE_CHECK_FAILED"
            return
        print("STATE_WRITE=PASS")
        status = "PASS"
        reason = "NONE"
    except (OSError, ValueError, subprocess.TimeoutExpired):
        reason = "HOST_OR_DOCKER_EXCEPTION"
    finally:
        print("VERIFY=" + status)
        print("ERROR=" + reason)
        print("EXIT_CODE=" + ("0" if status == "PASS" else "1"))
        print("PROJECT_END=LegacyGuard")
        print("========== GACE_RESULT_END ==========", flush=True)
    if status != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    execute()
