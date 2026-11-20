#!/usr/bin/env python3
"""Read-only real Telegram membership/rights check for the 3 adopted boards."""
from pathlib import Path
import json
import os
import stat
import sys
import urllib.parse
import urllib.request

SECRET=Path.home()/".config"/"gace"/"tgtumbler"/"gaybbs-bot.env"
BOARDS={
 "AREA_BBS":-1003847210571,
 "VIDEO_CHAT":-1002373696859,
 "GAY_BOARD":-1003770334893,
}
def api(token,method,fields=None):
    req=urllib.request.Request(
      "https://api.telegram.org/bot"+token+"/"+method,
      data=urllib.parse.urlencode(fields or {}).encode(),method="POST")
    with urllib.request.urlopen(req,timeout=12) as stream:
        answer=json.load(stream)
    if not answer.get("ok"):
        raise RuntimeError("API_REJECTED")
    return answer["result"]

def run():
    print("========== GACE_RESULT_BEGIN ==========",flush=True)
    print("PROJECT=TGtumbler")
    print("ACTION=GAYBBS_REAL_GROUP_PREFLIGHT_READ_ONLY")
    status="FAIL"
    error="UNKNOWN"
    try:
        if SECRET.is_symlink() or not SECRET.is_file() or stat.S_IMODE(SECRET.stat().st_mode)!=0o600:
            raise RuntimeError("SECRET_MISSING_OR_UNSAFE")
        lines=SECRET.read_text(encoding="utf-8").splitlines()
        vals=[x.split("=",1)[1] for x in lines if x.startswith("BOT_TOKEN=")]
        if len(vals)!=1:
            raise RuntimeError("SECRET_INVALID")
        token=vals[0]
        me=api(token,"getMe")
        if str(me.get("username","")).lower()!="gaybbs_bot" or int(me["id"])==8086265383:
            raise RuntimeError("BOT_IDENTITY_MISMATCH")
        print("BOT_IDENTITY=PASS")
        missing=[]
        for label,chat_id in BOARDS.items():
            try:
                chat=api(token,"getChat",{"chat_id":chat_id})
                if int(chat["id"])!=chat_id or chat.get("type")!="supergroup":
                    print(label+"=CHAT_MISMATCH")
                    missing.append(label)
                    continue
                admin=api(token,"getChatMember",{"chat_id":chat_id,"user_id":me["id"]})
                is_admin=admin.get("status") in ("administrator","creator")
                print(label+"="+("ADMIN" if is_admin else "NOT_ADMIN"))
                if not is_admin:
                    missing.append(label)
            except Exception:
                print(label+"=NOT_ACCESSIBLE")
                missing.append(label)
        print("GROUPS_READY="+("YES" if not missing else "NO"))
        status="PASS" if not missing else "PARTIAL"
        error="NONE" if not missing else "GROUP_MEMBERSHIP_OR_ID_NOT_READY"
    except Exception as e:
        error=str(e) if isinstance(e,RuntimeError) else "NETWORK_OR_SECRET_READ_FAILED"
    print("VERIFY="+status)
    print("ERROR="+error)
    print("EXIT_CODE="+("0" if status=="PASS" else "1"))
    print("PROJECT_END=TGtumbler")
    print("========== GACE_RESULT_END ==========",flush=True)
    return 0 if status=="PASS" else 1
if __name__=="__main__":
    sys.exit(run())
