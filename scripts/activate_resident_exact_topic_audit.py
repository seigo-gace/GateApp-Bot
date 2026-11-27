#!/usr/bin/env python3
"""Install targeted read-only topic lookup into the same resident Userbot.

No second Telegram client, no session modification or re-enrollment.
Both module and IPC client are pinned to exact source SHAs and rollbackable.
"""
from __future__ import annotations
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
FILES=("scripts/userbot_topic_entry_audit.py","scripts/userbot_topic_audit_client.py")
SERVICE="gace-userbot-verify.service"
ROLLBACK=ROOT.parent/".userbot-exact-topic-audit-rollback"

def run(args,timeout=45):
    p=subprocess.run(args,capture_output=True,text=True,check=False,timeout=timeout)
    return p.returncode,p.stdout
def sha_bytes(sha,name):
    p=subprocess.run(["git","show",f"{sha}:{name}"],
        stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,check=False,timeout=30)
    if p.returncode:raise RuntimeError("SOURCE_BLOB_NOT_FOUND")
    return p.stdout
def healthy(venv):
    c,out=run([str(venv),"scripts/userbot_test_client.py","health"],20)
    return c==0 and "USERBOT_TEST_RESULT=PASS" in out
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("dry-run","apply"),required=True)
    p.add_argument("--base-sha",required=True)
    p.add_argument("--source-sha",required=True)
    x=p.parse_args()
    if Path.cwd().resolve()!=ROOT.resolve():raise RuntimeError("WORKING_ROOT_MISMATCH")
    if not all(re.fullmatch("[a-f0-9]{40}",v) for v in (x.base_sha,x.source_sha)):
        raise RuntimeError("SOURCE_SHA_INVALID")
    c,active=run(["systemctl","--user","is-active",SERVICE])
    if c or active.strip()!="active":raise RuntimeError("USERBOT_INACTIVE")
    c,enabled=run(["systemctl","--user","is-enabled",SERVICE])
    if c or enabled.strip()!="enabled":raise RuntimeError("USERBOT_NOT_ENABLED")
    c,unit_root=run(["systemctl","--user","show",SERVICE,"-p","WorkingDirectory","--value"])
    if c or unit_root.strip()!=str(ROOT):raise RuntimeError("USERBOT_UNIT_ROOT_MISMATCH")
    session=ROOT/"deploy/secrets/userbot_verify.session"
    if not session.is_file() or session.is_symlink() or stat.S_IMODE(session.stat().st_mode)!=0o600:
        raise RuntimeError("USERBOT_SESSION_UNSAFE")
    session_id=session.stat().st_ino
    venv=ROOT/"deploy/.userbot-venv/bin/python"
    if not healthy(venv):raise RuntimeError("USERBOT_HEALTH_BEFORE_FAILED")
    pending={}
    for name in FILES:
        if (ROOT/name).read_bytes()!=sha_bytes(x.base_sha,name):
            raise RuntimeError("EXISTING_RUNTIME_AUDIT_SOURCE_DRIFT")
        desired=sha_bytes(x.source_sha,name)
        if desired==sha_bytes(x.base_sha,name):
            raise RuntimeError("NO_EXACT_TOPIC_AUDIT_CHANGE")
        pending[name]=desired
    with tempfile.TemporaryDirectory(prefix="exact-userbot-audit-") as temp:
        stage=Path(temp)
        for name,data in pending.items():
            item=stage/Path(name).name
            item.write_bytes(data)
            c,_=run([str(venv),"-m","py_compile",str(item)])
            if c:raise RuntimeError("EXACT_TOPIC_CODE_COMPILE_FAILED")
        print("EXACT_TOPIC_AUDIT_DRY_RUN=PASS")
        if x.mode=="dry-run":return
        ROLLBACK.mkdir(mode=0o700,exist_ok=True)
        if any(ROLLBACK.iterdir()):
            raise RuntimeError("EXACT_TOPIC_ROLLBACK_NOT_EMPTY")
        for name in FILES:
            shutil.copy2(ROOT/name,ROLLBACK/Path(name).name)
        changed=[]
        try:
            for name,data in pending.items():
                output=(ROOT/name).with_suffix(".audit-next")
                output.write_bytes(data)
                output.chmod(0o644)
                os.replace(output,ROOT/name)
                changed.append(name)
            c,_=run(["systemctl","--user","restart",SERVICE],45)
            if c:raise RuntimeError("USERBOT_CONTROLLED_RESTART_FAILED")
            up=False
            for _ in range(25):
                if healthy(venv):up=True;break
                time.sleep(2)
            if not up:raise RuntimeError("USERBOT_POST_RESTART_HEALTH_FAILED")
            if session.stat().st_ino!=session_id:raise RuntimeError("USERBOT_SESSION_REPLACED")
            c,out=run([str(venv),"scripts/userbot_topic_audit_client.py",
                        "--chat-id","-1002373696859","--topic-id","1613"],125)
            if c or "USERBOT_TOPIC_AUDIT=" not in out:
                raise RuntimeError("EXACT_TOPIC_LIVE_IPC_PROOF_FAILED")
            print("EXACT_TOPIC_AUDIT_LIVE_IPC=PASS")
            print("USERBOT_RESIDENT_SESSION_PRESERVED=PASS")
        except Exception:
            for name in changed:
                shutil.copy2(ROLLBACK/Path(name).name,ROOT/name)
            run(["systemctl","--user","restart",SERVICE],45)
            raise
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("EXACT_TOPIC_AUDIT_ACTIVATION=FAILED")
        print("EXACT_TOPIC_ERROR="+type(exc).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(exc).upper())[:100])
        raise SystemExit(1)
