#!/usr/bin/env python3
"""Recover one verified-denied Telegram General-topic menu without duplicate.
General topic 1 requires sendMessage without message_thread_id.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import re

sys.path.insert(0,str(Path(__file__).resolve().parent))
import publish_missing_normal_topic_buttons as norm

ROOT=norm.ROOT
TARGETS={"video":norm.CHATS["video"],"category":norm.CHATS["category"]}
LEDGER=ROOT/"deploy/state/general-topic-button-recovery-20261122"
OLD=ROOT/"deploy/state/missing-normal-topic-buttons-20261122/video/1.json"

def preflight(group,pg,bot):
    chat=TARGETS[group]
    if norm.run(["systemctl","--user","is-active","gace-userbot-verify.service"])[1].strip()!="active":
        raise RuntimeError("USERBOT_INACTIVE")
    row=norm.live_rows(group,0 if group=="category" else 1).get(1)
    norm.assert_absent(row,1)
    a=norm.db_query(pg,f"""SELECT state,COALESCE(message_id,0),pinned FROM topic_dm_entry_pins
        WHERE chat_id={chat} AND message_thread_id=1;""")
    if group=="video":
        if not OLD.is_file() or json.loads(OLD.read_text()).get("state")!="DENIED":
            raise RuntimeError("PREVIOUS_TELEGRAM_DENIAL_UNVERIFIED")
        if a!=["verified|0|f"]:
            raise RuntimeError("FAILED_VIDEO_GENERAL_ATTEMPT_NOT_RECONCILABLE")
    elif a:
        raise RuntimeError("CATEGORY_GENERAL_EXISTING_PIN_PROTECTED")
    r=LEDGER/(group+".json")
    if r.exists():raise RuntimeError("GENERAL_TOPIC_ALREADY_ATTEMPTED")
    code,me=norm.bot_call(bot,{"action":"identity"})
    if code or me.get("state")!="IDENTITY_VERIFIED":
        raise RuntimeError("BOT_IDENTITY_INVALID")
    return row["title"]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--mode",choices=("dry-run","apply"),required=True)
    ap.add_argument("--group",choices=TARGETS,required=True)
    x=ap.parse_args()
    if Path.cwd().resolve()!=ROOT.resolve():
        raise RuntimeError("SOURCE_ROOT_INVALID")
    pg=norm.unique_container("postgres")
    bot=norm.unique_container("gaybbs")
    title=preflight(x.group,pg,bot)
    print("GENERAL_TOPIC_PREFLIGHT=PASS "+x.group)
    if x.mode=="dry-run":return
    LEDGER.mkdir(mode=0o700,parents=True,exist_ok=True)
    path=LEDGER/(x.group+".json")
    with os.fdopen(os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
        json.dump({"state":"ATTEMPTING","group":x.group},f)
        f.flush();os.fsync(f.fileno())
    # Re-check immediately before making any change.
    row=norm.live_rows(x.group,0 if x.group=="category" else 1).get(1)
    norm.assert_absent(row,1)
    chat=TARGETS[x.group]
    if x.group=="video":
        removed=norm.db_query(pg,f"""DELETE FROM topic_dm_entry_pins
         WHERE chat_id={chat} AND message_thread_id=1 AND state='verified'
           AND message_id IS NULL AND pinned=FALSE
         RETURNING message_thread_id;""")
        if removed!=["1"]:raise RuntimeError("PREVIOUS_DENIED_LEDGER_CHANGED")
    else:
        norm.check_db(pg,chat,1)
    token=base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
    if len(token)!=32:raise RuntimeError("GENERAL_TOKEN_INVALID")
    digest=norm.insert_token(pg,chat,1,title,token)
    code,r=norm.bot_call(bot,{"action":"publish","chat_id":chat,"thread_id":1,
                            "callback_data":"gdm:p_"+token})
    mid=r.get("message_id")
    if code or r.get("state") not in ("PUBLISHED_PINNED","PUBLISHED_NOT_PINNED") or not isinstance(mid,int):
        norm.persist(path,{"state":r.get("state","UNCERTAIN"),"code":r.get("code")})
        raise RuntimeError("GENERAL_SEND_NOT_CONFIRMED")
    norm.finalize(pg,chat,1,digest,mid,bool(r.get("pinned")))
    norm.persist(path,{"state":"PUBLISHED","message_id":mid,"pinned":bool(r.get("pinned"))})
    print("GENERAL_TOPIC_PUBLISHED="+x.group+":"+str(mid))
if __name__=="__main__":
    try:main()
    except Exception as e:
        print("GENERAL_TOPIC_RECOVERY=FAILED")
        print("GENERAL_TOPIC_ERROR="+type(e).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(e).upper())[:100])
        raise SystemExit(1)
