#!/usr/bin/env python3
"""Read-only LegacyGuard runtime acceptance without exposing bot token, IDs or logs."""
from pathlib import Path
import json
import stat
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT=Path("/home/gace/legacy-group-guard-deploy/operations/legacy-group-guard")
CID=-1002374817170
BOT=8086265383
EXPECTED_TITLE="閉鎖したグループ"
EXPECTED_DESCRIPTION="このグループは閉鎖され一切の機能を停止しています"
DENIED=("can_send_messages","can_send_audios","can_send_documents",
        "can_send_photos","can_send_videos","can_send_video_notes",
        "can_send_voice_notes","can_send_polls","can_send_other_messages",
        "can_add_web_page_previews","can_change_info","can_invite_users",
        "can_pin_messages","can_manage_topics")

def cmd(args):
    p=subprocess.run(args,cwd=ROOT,capture_output=True,text=True,timeout=15)
    if p.returncode!=0:
        raise RuntimeError("HOST_COMMAND_FAILED")
    return p.stdout

def call(token,name,vals=None):
    url="https://api.telegram.org/bot"+token+"/"+name
    body=urllib.parse.urlencode(vals or {}).encode()
    req=urllib.request.Request(url,data=body,method="POST")
    with urllib.request.urlopen(req,timeout=12) as stream:
        answer=json.load(stream)
    if not answer.get("ok"):
        raise RuntimeError("TELEGRAM_API_FAILED_"+name)
    return answer["result"]

def main():
    print("========== GACE_RESULT_BEGIN ==========",flush=True)
    print("PROJECT=LegacyGuard")
    print("ACTION=LIVE_RUNTIME_ACCEPTANCE_READ_ONLY")
    ok=False
    reason="UNKNOWN"
    try:
        if not ROOT.is_dir():
            raise RuntimeError("DEPLOY_ROOT_MISSING")
        env=ROOT/".env"
        if not env.is_file() or stat.S_IMODE(env.stat().st_mode)!=0o600:
            raise RuntimeError("ENV_UNSAFE")
        c={}
        for line in env.read_text().splitlines():
            line=line.strip()
            if line and not line.startswith("#") and "=" in line:
                k,v=line.split("=",1)
                c[k.strip()]=v.strip().strip('"').strip("'")
        if c.get("OLD_CHAT_ID")!=str(CID) or not c.get("GUARD_BOT_TOKEN"):
            raise RuntimeError("GUARD_ENV_MISMATCH")
        token=c["GUARD_BOT_TOKEN"]
        running=cmd(["docker","compose","ps","--status","running","-q","legacy-group-guard"]).splitlines()
        print("RUNNING_INSTANCES="+str(len(running)))
        if len(running)!=1:
            raise RuntimeError("NOT_EXACTLY_ONE_GUARD")
        info=cmd(["docker","inspect","--format","{{.RestartCount}}",running[0]]).strip()
        print("RESTART_COUNT="+(info if info.isdigit() else "UNKNOWN"))
        logs=cmd(["docker","compose","logs","--no-color","--tail","300","legacy-group-guard"])
        print("READY_LOG="+("YES" if "Guard ready:" in logs else "NO"))
        print("UPDATE_ACTION_LINES="+str(logs.count("Guard actions update=")))
        print("UPDATE_FAILURE_LINES="+str(logs.count("Update failed id=")))
        print("CYCLE_FAILURE_LINES="+str(logs.count("Guard cycle failure:")))
        if "Guard ready:" not in logs:
            raise RuntimeError("GUARD_READY_NOT_SEEN")
        state=ROOT/"state"/"state.json"
        if state.is_file():
            obj=json.loads(state.read_text())
            off=obj.get("offset")
            print("OFFSET_PRESENT="+("YES" if isinstance(off,int) and off>=0 else "NO"))
        else:
            print("OFFSET_PRESENT=NO")
        if call(token,"getMe").get("id")!=BOT:
            raise RuntimeError("BOT_ID_MISMATCH")
        if call(token,"getWebhookInfo").get("url"):
            raise RuntimeError("WEBHOOK_RECONFIGURED")
        print("POLLING_WEBHOOK_EMPTY=PASS")
        chat=call(token,"getChat",{"chat_id":CID})
        if chat.get("id")!=CID or chat.get("type")!="supergroup":
            raise RuntimeError("CHAT_MISMATCH")
        print("TITLE=PASS" if chat.get("title")==EXPECTED_TITLE else "TITLE=FAIL")
        print("DESCRIPTION=PASS" if chat.get("description")==EXPECTED_DESCRIPTION else "DESCRIPTION=FAIL")
        print("PHOTO=NONE" if not chat.get("photo") else "PHOTO=PRESENT")
        rights=chat.get("permissions") or {}
        enabled=[k for k in DENIED if rights.get(k) is True]
        print("MEMBER_ENABLED="+(",".join(enabled) if enabled else "NONE"))
        if chat.get("title")!=EXPECTED_TITLE or chat.get("description")!=EXPECTED_DESCRIPTION or chat.get("photo") or enabled:
            raise RuntimeError("GROUP_LOCK_READBACK_FAILED")
        ok=True
        reason="NONE"
    except Exception as exc:
        reason=str(exc) if isinstance(exc,RuntimeError) else "HOST_OR_API_EXCEPTION_"+type(exc).__name__
    print("VERIFY="+("PASS" if ok else "FAIL"))
    print("ERROR="+reason)
    print("EXIT_CODE="+("0" if ok else "1"))
    print("PROJECT_END=LegacyGuard")
    print("========== GACE_RESULT_END ==========",flush=True)
    return 0 if ok else 1

if __name__=="__main__":
    sys.exit(main())
