#!/usr/bin/env python3
"""Refresh only the resident Userbot topic audit module with rollback."""
import argparse
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time

ROOT=Path("/home/gace/Project/Gserver/projects/TGtumbler/GateApp-Bot")
SERVICE="gace-userbot-verify.service"
MODULE="scripts/userbot_topic_entry_audit.py"
CLIENT="scripts/userbot_test_client.py"
IPC="scripts/userbot_resident_ipc.py"

def run(argv, timeout=30):
    p=subprocess.run(argv,text=True,stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL,timeout=timeout)
    return p.returncode,p.stdout

def healthy(venv):
    code,out=run([str(venv),CLIENT,"health"],20)
    return code==0 and "USERBOT_TEST_RESULT=PASS" in out

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--source-sha",required=True)
    parser.add_argument("--base-sha",required=True)
    parser.add_argument("--mode",choices=("dry-run","apply"),required=True)
    opts=parser.parse_args()
    if not all(re.fullmatch("[a-f0-9]{40}",v) for v in (opts.source_sha,opts.base_sha)):
        raise RuntimeError("AUDIT_SHA_INVALID")
    if Path.cwd().resolve()!=ROOT.resolve():
        raise RuntimeError("AUDIT_ROOT_MISMATCH")
    if '"topic_entry_audit"' not in (ROOT/IPC).read_text():
        raise RuntimeError("AUDIT_IPC_NOT_ACTIVE")
    if not (ROOT/"scripts/userbot_topic_audit_client.py").is_file():
        raise RuntimeError("AUDIT_CLIENT_MISSING")
    venv=ROOT/"deploy/.userbot-venv/bin/python"
    if not venv.is_file():
        raise RuntimeError("AUDIT_VENV_MISSING")
    code,out=run(["systemctl","--user","is-active",SERVICE])
    if code or out.strip()!="active" or not healthy(venv):
        raise RuntimeError("AUDIT_SERVICE_PRECHECK_FAILED")
    session=ROOT/"deploy/secrets/userbot_verify.session"
    if not session.is_file() or stat.S_IMODE(session.stat().st_mode)!=0o600:
        raise RuntimeError("AUDIT_SESSION_PRECHECK_FAILED")
    session_id=session.stat().st_ino
    before=subprocess.run(["git","show",opts.base_sha+":"+MODULE],
                          stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    after=subprocess.run(["git","show",opts.source_sha+":"+MODULE],
                         stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    if before.returncode or after.returncode:
        raise RuntimeError("AUDIT_SOURCE_NOT_FOUND")
    if (ROOT/MODULE).read_bytes()!=before.stdout:
        raise RuntimeError("AUDIT_UNEXPECTED_EXISTING_MODULE")
    with tempfile.TemporaryDirectory(prefix="gace-topic-audit-v2-") as tmp:
        p=Path(tmp)/"userbot_topic_entry_audit.py"
        p.write_bytes(after.stdout)
        code,_=run([str(venv),"-m","py_compile",str(p)])
        if code:raise RuntimeError("AUDIT_NEW_MODULE_COMPILE_FAILED")
        print("AUDIT_HISTORY_MODULE_DRY_RUN=PASS")
        if opts.mode=="dry-run":return
        backup=ROOT.parent/".userbot-topic-audit-history-backup-v3"
        backup.mkdir(mode=0o700,exist_ok=True)
        if any(backup.iterdir()):
            raise RuntimeError("AUDIT_HISTORY_BACKUP_EXISTS")
        shutil.copy2(ROOT/MODULE,backup/"userbot_topic_entry_audit.py")
        changed=False
        try:
            swap=ROOT/(MODULE+".next")
            swap.write_bytes(after.stdout)
            swap.chmod(0o644)
            os.replace(swap,ROOT/MODULE)
            changed=True
            code,_=run(["systemctl","--user","restart",SERVICE],45)
            if code:raise RuntimeError("AUDIT_RESTART_FAILED")
            valid=False
            for _ in range(20):
                if healthy(venv):
                    valid=True
                    break
                time.sleep(2)
            if not valid:raise RuntimeError("AUDIT_POST_RESTART_HEALTH_FAILED")
            if session.stat().st_ino!=session_id:
                raise RuntimeError("AUDIT_SESSION_INODE_CHANGED")
            code,out=run(["systemctl","--user","is-active",SERVICE])
            if code or out.strip()!="active":
                raise RuntimeError("AUDIT_SERVICE_STOPPED")
            print("AUDIT_HISTORY_MODULE_RUNTIME=PASS")
            print("AUDIT_SESSION_PRESERVED=PASS")
        except Exception:
            if changed:
                shutil.copy2(backup/"userbot_topic_entry_audit.py",ROOT/MODULE)
                run(["systemctl","--user","restart",SERVICE],45)
            raise

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        print("AUDIT_HISTORY_ACTIVATION=FAILED")
        print("AUDIT_HISTORY_ERROR="+type(exc).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(exc).upper())[:100])
        raise SystemExit(1)
