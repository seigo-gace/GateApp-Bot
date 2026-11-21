#!/usr/bin/env python3
"""Activate a strictly allowlisted read-only topic audit on existing Userbot.
No independent MTProto client, session edit, login or unrelated source overwrite.
"""
from __future__ import annotations
import argparse
import os
import pathlib
import re
import shutil
import stat
import subprocess
import tempfile
import time

ROOT = pathlib.Path("/home/gace/Project/Gserver/projects/TGtumbler/GateApp-Bot")
FILES = ("scripts/userbot_resident_ipc.py",)
CLIENT = "scripts/userbot_topic_audit_client.py"
MODULE = "scripts/userbot_topic_entry_audit.py"
SERVICE = "gace-userbot-verify.service"
ACTION = "topic_entry_audit"


def replace_once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise RuntimeError("AUDIT_PATCH_ANCHOR_MISMATCH")
    return source.replace(old, new, 1)


def patch_ipc(s: str) -> str:
    if '"topic_entry_audit"' in s:
        raise RuntimeError("AUDIT_ALREADY_REGISTERED")
    m = re.search(r"^ACTIONS = frozenset\(\{[^\n]+\}\)$", s, re.M)
    if not m:
        raise RuntimeError("IPC_ACTIONS_ANCHOR_MISSING")
    s = replace_once(s, m.group(), m.group()[:-2] + ', "topic_entry_audit"})')
    s = replace_once(s, '    if set(request) != expected:',
        '    if action == "topic_entry_audit":\n'
        '        expected = {"request_id", "action", "chat_id", "page"}\n'
        '    if set(request) != expected:')
    s = replace_once(s, '    if action == "health":',
        '    if action == "topic_entry_audit":\n'
        '        from userbot_topic_entry_audit import audit\n'
        '        return {"request_id": request_id,\n'
        '                **await audit(client, request["chat_id"], request["page"])}\n'
        '    if action == "health":')
    s = replace_once(s, '                if request.get("action") == "link_rich_flow_smoke":',
        '                if request.get("action") == "topic_entry_audit":\n'
        '                    response = await asyncio.wait_for(process_request(client, request),timeout=100)\n'
        '                elif request.get("action") == "link_rich_flow_smoke":')
    s = replace_once(s, '"REQUEST_SIZE_INVALID",', 
        '"REQUEST_SIZE_INVALID",\n'
        '                "TOPIC_AUDIT_CHAT_NOT_ALLOWED", "TOPIC_AUDIT_PAGE_INVALID",\n'
        '                "TOPIC_AUDIT_GROUP_NOT_JOINED", "TOPIC_AUDIT_TOPIC_LIMIT",\n'
        '                "TOPIC_AUDIT_PAGINATION_LIMIT", "TOPIC_AUDIT_PAGINATION_STALLED",\n'
        '                "TOPIC_AUDIT_TARGET_BOT_INVALID",')
    return s


def patch_client(s: str) -> str:
    if 'topic_entry_audit' in s:
        raise RuntimeError("CLIENT_AUDIT_ALREADY_PRESENT")
    s = replace_once(s, 'topic_ids: list[int] | None = None, code: str | None = None)',
        'topic_ids: list[int] | None = None, code: str | None = None, page: int | None = None)')
    s = replace_once(s, '        elif action == "room_public_readback":',
        '        elif action == "topic_entry_audit":\n'
        '            if type(chat_id) is not int or type(page) is not int or message_id is not None or topic_ids is not None or code is not None:\n'
        '                raise ValueError("TOPIC_AUDIT_TARGET_REQUIRED")\n'
        '            request.update({"chat_id": chat_id, "page": page})\n'
        '        elif action == "room_public_readback":')
    s = replace_once(s, ' else 40)', ' or action == "topic_entry_audit" else 40)')
    s = replace_once(s, '    parser.add_argument("--message-id", type=int)',
        '    parser.add_argument("--message-id", type=int)\n'
        '    parser.add_argument("--page", type=int)')
    s = replace_once(s, 'topic_ids, args.code))', 'topic_ids, args.code, args.page))')
    s = replace_once(s, '        if args.action == "bug_report_delivery_smoke":',
        '        if args.action == "topic_entry_audit":\n'
        '            if not isinstance(result.get("rows"), list):\n'
        '                raise RuntimeError("TOPIC_AUDIT_RESPONSE_INVALID")\n'
        '            print("USERBOT_TOPIC_AUDIT=" + json.dumps(result, ensure_ascii=False, separators=(",", ":")))\n'
        '        if args.action == "bug_report_delivery_smoke":')
    return s


def run(args, timeout=30):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                       text=True, timeout=timeout, check=False)
    return p.returncode, p.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("dry-run", "apply"), required=True)
    parser.add_argument("--source-sha", required=True)
    opts = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", opts.source_sha):
        raise RuntimeError("AUDIT_SOURCE_SHA_INVALID")
    if pathlib.Path.cwd().resolve() != ROOT.resolve():
        raise RuntimeError("AUDIT_RUNTIME_ROOT_MISMATCH")
    code, active = run(["systemctl", "--user", "is-active", SERVICE])
    if code or active.strip() != "active":
        raise RuntimeError("AUDIT_RESIDENT_SERVICE_INACTIVE")
    code, unit_root = run(["systemctl", "--user", "show", SERVICE,
                           "-p", "WorkingDirectory", "--value"])
    if code or unit_root.strip() != str(ROOT):
        raise RuntimeError("AUDIT_UNIT_WRONG_ROOT")
    venv = ROOT / "deploy/.userbot-venv/bin/python"
    if not venv.is_file():
        raise RuntimeError("AUDIT_VENV_MISSING")
    code, enabled = run(["systemctl", "--user", "is-enabled", SERVICE])
    if code or enabled.strip() != "enabled":
        raise RuntimeError("AUDIT_SERVICE_NOT_ENABLED")
    session = ROOT / "deploy/secrets/userbot_verify.session"
    if not session.is_file() or stat.S_IMODE(session.stat().st_mode) != 0o600:
        raise RuntimeError("AUDIT_SESSION_SAFETY_UNVERIFIED")
    original_session = (session.stat().st_ino, session.stat().st_mode)
    code, result = run([str(venv), "scripts/userbot_test_client.py", "health"], 45)
    if code or "USERBOT_TEST_RESULT=PASS" not in result:
        raise RuntimeError("AUDIT_HEALTH_BEFORE_FAILED")
    for name in FILES:
        code, _ = run(["git", "diff", "--quiet", "--", name])
        if code:
            raise RuntimeError("AUDIT_EXISTING_LOCAL_EDIT_PROTECTED")
    if (ROOT / MODULE).exists() or (ROOT / CLIENT).exists():
        raise RuntimeError("AUDIT_MODULE_ALREADY_EXISTS")
    sources = {}
    for name in (*FILES, MODULE, CLIENT):
        cp = subprocess.run(["git", "show", opts.source_sha + ":" + name],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
        if cp.returncode:
            raise RuntimeError("AUDIT_PINNED_SOURCE_MISSING")
        sources[name] = cp.stdout.decode("utf-8")
    # The new audit module is only a source for a new file. Patch current
    # operational files in place to preserve all later runtime additions.
    patched = {
        FILES[0]: patch_ipc((ROOT / FILES[0]).read_text()),
        MODULE: sources[MODULE],
        CLIENT: sources[CLIENT],
    }
    with tempfile.TemporaryDirectory(prefix="gace-audit-stage-") as stage:
        stage_path = pathlib.Path(stage)
        for name, content in patched.items():
            temp = stage_path / pathlib.Path(name).name
            temp.write_text(content)
            code, _ = run([str(venv), "-m", "py_compile", str(temp)])
            if code:
                raise RuntimeError("AUDIT_PATCH_COMPILE_FAILED")
        print("USERBOT_AUDIT_PATCH_DRY_RUN=PASS")
        if opts.mode == "dry-run":
            return
        rollback = ROOT.parent / ".userbot-topic-audit-rollback-v2"
        rollback.mkdir(mode=0o700, exist_ok=True)
        if any(rollback.iterdir()):
            raise RuntimeError("AUDIT_ROLLBACK_DIR_NOT_EMPTY")
        for name in FILES:
            shutil.copy2(ROOT / name, rollback / pathlib.Path(name).name)
        updated = []
        try:
            for name in (*FILES, MODULE, CLIENT):
                old_file = ROOT / name
                temp = stage_path / pathlib.Path(name).name
                swap = old_file.with_suffix(old_file.suffix + ".audit-next")
                swap.write_bytes(temp.read_bytes())
                swap.chmod(0o644)
                os.replace(swap, old_file)
                updated.append(name)
            code, _ = run(["systemctl", "--user", "restart", SERVICE], 45)
            if code:
                raise RuntimeError("AUDIT_RESTART_FAILED")
            code, active = run(["systemctl", "--user", "is-active", SERVICE])
            if code or active.strip() != "active":
                raise RuntimeError("AUDIT_POST_RESTART_INACTIVE")
            if (session.stat().st_ino, session.stat().st_mode) != original_session:
                raise RuntimeError("AUDIT_SESSION_CHANGED")
            healthy = False
            for _ in range(20):
                code, result = run([str(venv), "scripts/userbot_test_client.py", "health"], 12)
                if not code and "USERBOT_TEST_RESULT=PASS" in result:
                    healthy = True
                    break
                time.sleep(2)
            if not healthy:
                raise RuntimeError("AUDIT_HEALTH_AFTER_FAILED")
            print("USERBOT_AUDIT_RUNTIME_ACTIVATED=PASS")
            print("USERBOT_SESSION_PRESERVED=YES")
        except Exception:
            for name in FILES:
                backup = rollback / pathlib.Path(name).name
                if backup.is_file():
                    shutil.copy2(backup, ROOT / name)
            for name in (MODULE, CLIENT):
                if name in updated:
                    (ROOT / name).unlink(missing_ok=True)
            run(["systemctl", "--user", "restart", SERVICE], 45)
            raise


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("USERBOT_AUDIT_ACTIVATION=FAILED")
        print("USERBOT_AUDIT_ERROR=" + type(exc).__name__ + "_" +
              re.sub(r"[^A-Z0-9_]", "_", str(exc).upper())[:120])
        raise SystemExit(1)
