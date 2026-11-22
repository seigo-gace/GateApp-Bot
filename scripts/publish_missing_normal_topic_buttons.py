#!/usr/bin/env python3
"""Repair genuinely missing normal posting entrances without replacing existing posts.

Source: actual three Telegram forum Userbot audit. Requires fresh live readback
and empty DB pin ledger before each Bot message. Existing groups, private
session, other Bot menus and all old Telegram posts are protected.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

ROOT = Path("/home/gace/Project/Gserver/projects/TGtumbler/GateApp-Bot")
ADMIN = 7880448530
LEDGER = ROOT / "deploy/state/missing-normal-topic-buttons-20261122"
CHATS = {"area": -1003847210571, "video": -1002373696859, "category": -1003770334893}
# Audited Telegram topic IDs; no online, profile-only or creator-only topics.
TARGETS = {
    "area": {
        0: [1379],
        7: [995, 994, 993],
        8: [992, 991, 990, 621, 999, 998, 997, 996],
        9: [44, 105],
    },
    "video": {0: [1723, 4672]},
    "category": {0: [783]},
}
# Existing database pin records for area:273, video:1724,4291 and category:18
# require in-place readback/reconciliation, never a new send.
# Video/category Topic 1 requires a separately verified General-topic protocol.
# Topic 1 in area was INCONCLUSIVE_HISTORY_LIMIT and cannot be sent without
# exhaustive existing-history verification. Keep it outside this run.
assert set(TARGETS["area"][8]) == {992, 991, 990, 621, 999, 998, 997, 996}

BOT_NODE = r"""
'use strict';
const fs=require('node:fs'), https=require('node:https');
const token=fs.readFileSync(process.env.BOT_TOKEN_FILE||'/run/secrets/bot_token','utf8').trim();
const task=__TASK_JSON__;
const agent=new https.Agent({keepAlive:false,family:4,timeout:20000});
function api(method,data){
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(data||{});
  const req=https.request({hostname:'api.telegram.org',port:443,
   path:'/bot'+token+'/'+method,method:'POST',agent,timeout:25000,
   headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
    let text='';
    res.setEncoding('utf8');
    res.on('data',s=>{if(text.length<20000)text+=s;});
    res.on('end',()=>{
     try {
      const v=JSON.parse(text);
      resolve(v.ok===true?{ok:true,value:v.result}:{ok:false,code:Number(v.error_code)||res.statusCode});
     }catch{reject(Error('API_RESPONSE_INVALID'));}
    });
   });
  req.on('error',()=>reject(Error('NETWORK_UNCERTAIN')));
  req.on('timeout',()=>req.destroy(Error('TIMEOUT_UNCERTAIN')));
  req.end(body);
 });
}
(async()=>{
 const me=await api('getMe',{});
 if(!me.ok||String(me.value?.username||'').toLowerCase()!=='gaybbs_bot'||me.value.id===8086265383)
  throw Error('BOT_IDENTITY_INVALID');
 if(task.action==='identity'){console.log(JSON.stringify({state:'IDENTITY_VERIFIED'}));return;}
 if(task.action!=='publish')throw Error('ACTION_DENIED');
 if(![-1003847210571,-1002373696859,-1003770334893].includes(task.chat_id)||
    !Number.isInteger(task.thread_id)||task.thread_id<=0)throw Error('TARGET_INVALID');
 if(!/^gdm:p_[A-Za-z0-9_-]{32}$/.test(task.callback_data))throw Error('CALLBACK_INVALID');
 const reply_markup={inline_keyboard:[[{
   text:'📝 投稿メニューを開く',callback_data:task.callback_data
 }]]};
 const result=await api('sendMessage',{
  chat_id:task.chat_id,message_thread_id:task.thread_id,
  text:'📝 このトピックに投稿するには、下のボタンからBotのDMへ移動してください。',
  disable_notification:true,reply_markup
 });
 if(!result.ok){
  console.log(JSON.stringify({state:'DENIED',code:result.code}));
  process.exitCode=2;return;
 }
 const msg=result.value;
 if(!msg||msg.chat?.id!==task.chat_id||msg.message_thread_id!==task.thread_id||
    !Number.isInteger(msg.message_id)||msg.message_id<=0)throw Error('SEND_RESULT_UNCERTAIN');
 const pin=await api('pinChatMessage',{chat_id:task.chat_id,message_id:msg.message_id,disable_notification:true});
 console.log(JSON.stringify({state:pin.ok?'PUBLISHED_PINNED':'PUBLISHED_NOT_PINNED',
   message_id:msg.message_id,pinned:pin.ok,pin_code:pin.ok?null:pin.code}));
})().catch(e=>{
 console.log(JSON.stringify({state:'UNCERTAIN',
   category:String(e?.message||'UNKNOWN').replace(/[^A-Z_]/g,'').slice(0,70)}));
 process.exitCode=3;
});
"""

def run(argv, input_data=None, timeout=125):
    p=subprocess.run(argv, input=input_data, text=True, stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    return p.returncode,p.stdout

def unique_container(phrase):
    code,out=run(["docker","ps","--format","{{.Names}}"],timeout=20)
    names=[x for x in out.splitlines() if re.search(phrase,x,re.I)]
    if code or len(names)!=1:raise RuntimeError("REQUIRED_CONTAINER_NOT_UNIQUE")
    return names[0]

def db_query(pg,query):
    code,out=run(["docker","exec","-i",pg,"sh","-c",
      'exec psql -X -q -U "$POSTGRES_USER" -d gaybbs -At -F "|" -v ON_ERROR_STOP=1 -f -'],
      input_data=query,timeout=35)
    if code:raise RuntimeError("DB_QUERY_FAILED")
    return [x.strip() for x in out.splitlines() if x.strip()]

def bot_call(bot,task):
    code,out=run(["docker","exec","-i",bot,"node","-"],
                input_data=BOT_NODE.replace("__TASK_JSON__",json.dumps(task,ensure_ascii=False)),timeout=75)
    rows=[x for x in out.splitlines() if x.startswith("{")]
    if len(rows)!=1:raise RuntimeError("BOT_RESULT_UNCERTAIN")
    try: obj=json.loads(rows[0])
    except ValueError:raise RuntimeError("BOT_RESULT_JSON_UNCERTAIN") from None
    return code,obj

def live_rows(group,page):
    code,out=run([sys.executable,"scripts/userbot_topic_audit_client.py",
                  "--chat-id",str(CHATS[group]),"--page",str(page)],timeout=120)
    if code:raise RuntimeError("USERBOT_AUDIT_FAILED")
    data=[json.loads(x.split("=",1)[1]) for x in out.splitlines()
          if x.startswith("USERBOT_TOPIC_AUDIT=")]
    if len(data)!=1 or data[0].get("chat")!=group or data[0].get("page")!=page:
        raise RuntimeError("USERBOT_RESULT_INVALID")
    return {int(x["topic_id"]):x for x in data[0]["rows"]}

def assert_absent(row,topic):
    if not row or int(row.get("topic_id",-1))!=topic:
        raise RuntimeError("TOPIC_ID_NOT_VERIFIED")
    if row.get("post_button")!="ABSENT" or row.get("pin_state")!="ABSENT_FROM_PINS":
        raise RuntimeError("TOPIC_EXISTING_BUTTON_OR_INCONCLUSIVE")
    if row.get("history_inspected",0)<1:
        raise RuntimeError("TOPIC_HISTORY_UNCHECKED")
    title=str(row.get("title",""))
    if not title or len(title)>120:
        raise RuntimeError("TOPIC_TITLE_INVALID")
    return title

def check_db(pg,chat,topic):
    # No published/unknown existing entries, and never replace another panel.
    hits=db_query(pg,f"""SELECT COUNT(*) FROM topic_dm_entry_pins
      WHERE chat_id={chat} AND message_thread_id={topic};
    SELECT COUNT(*) FROM board_menu_panels
      WHERE chat_id={chat} AND message_thread_id={topic} AND panel_type='posting';""")
    if hits != ["0","0"]:
        raise RuntimeError("TOPIC_EXISTING_DB_ENTRY_PROTECTED")

def persist(path,value):
    next_path=path.with_suffix(".next")
    fd=os.open(next_path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,"w") as out:
        json.dump(value,out,ensure_ascii=False,sort_keys=True)
        out.flush()
        os.fsync(out.fileno())
    os.replace(next_path,path)

def insert_token(pg,chat,topic,title,token):
    digest=hashlib.sha256(("GayBBS-menu-v1:"+token).encode()).hexdigest()
    # Only validated titles from Userbot, safe parameterization via strict
    # one-quote SQL escape (no user input enters through command line).
    safe_title=title.replace("'","''")
    rows=db_query(pg,f"""INSERT INTO topic_dm_entry_pins
       (chat_id,message_thread_id,title,token_hash,state,pinned,verified_by,verified_at)
       VALUES({chat},{topic},'{safe_title}','{digest}','verified',FALSE,{ADMIN},NOW())
       ON CONFLICT(chat_id,message_thread_id) DO NOTHING
       RETURNING message_thread_id;""")
    if rows!=[str(topic)]:raise RuntimeError("TOPIC_PIN_TOKEN_REGISTRATION_FAILED")
    return digest

def finalize(pg,chat,topic,digest,mid,pinned):
    rows=db_query(pg,f"""UPDATE topic_dm_entry_pins SET message_id={mid},
       state='published',pinned={'TRUE' if pinned else 'FALSE'},updated_at=NOW()
       WHERE chat_id={chat} AND message_thread_id={topic} AND token_hash='{digest}'
       AND state='verified' AND message_id IS NULL
       RETURNING message_id;""")
    if rows!=[str(mid)]:raise RuntimeError("TOPIC_PIN_LEDGER_FINALIZATION_UNKNOWN")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("dry-run","apply"),required=True)
    p.add_argument("--group",choices=tuple(CHATS),required=True)
    p.add_argument("--page",type=int,default=None)
    a=p.parse_args()
    if Path.cwd().resolve()!=ROOT.resolve():raise RuntimeError("PROJECT_ROOT_MISMATCH")
    code,s=run(["systemctl","--user","is-active","gace-userbot-verify.service"])
    if code or s.strip()!="active":raise RuntimeError("USERBOT_INACTIVE")
    pg=unique_container("postgres")
    bot=unique_container("gaybbs")
    code,r=bot_call(bot,{"action":"identity"})
    if code or r.get("state")!="IDENTITY_VERIFIED":raise RuntimeError("BOT_IDENTITY_FAILED")
    group=a.group
    pages={page:ids for page,ids in TARGETS[group].items()
           if a.page is None or page==a.page}
    if not pages:raise RuntimeError("TARGET_PAGE_NOT_IN_SCOPE")
    scanned={}
    for page in pages:
        scanned[page]=live_rows(group,page)
        for topic in pages[page]:
            assert_absent(scanned[page].get(topic),topic)
            check_db(pg,CHATS[group],topic)
            if (LEDGER/group/(str(topic)+".json")).exists():
                raise RuntimeError("TOPIC_PREVIOUS_ATTEMPT_PROTECTED")
    print("NORMAL_GROUP_PREFLIGHT=PASS "+group+" total="+str(sum(map(len,pages.values()))))
    if a.mode=="dry-run":return
    (LEDGER/group).mkdir(parents=True,mode=0o700,exist_ok=True)
    published=0
    for page,topics in pages.items():
        for topic in topics:
            record=LEDGER/group/(str(topic)+".json")
            with os.fdopen(os.open(record,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
                json.dump({"state":"ATTEMPTING","group":group,"topic":topic},f)
                f.flush();os.fsync(f.fileno())
            # Never publish after discovery of an existing or ambiguous message.
            row=live_rows(group,page).get(topic)
            title=assert_absent(row,topic)
            check_db(pg,CHATS[group],topic)
            token=base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
            if len(token)!=32:raise RuntimeError("TOKEN_LENGTH_INVALID")
            digest=insert_token(pg,CHATS[group],topic,title,token)
            code,response=bot_call(bot,{
                "action":"publish","chat_id":CHATS[group],"thread_id":topic,
                "callback_data":"gdm:p_"+token})
            mid=response.get("message_id")
            if code or response.get("state") not in ("PUBLISHED_PINNED","PUBLISHED_NOT_PINNED") or not isinstance(mid,int):
                persist(record,{"group":group,"topic":topic,"state":response.get("state","UNCERTAIN"),
                                "error_code":response.get("code")})
                raise RuntimeError("TELEGRAM_SEND_NOT_VERIFIED")
            pinned=bool(response.get("pinned"))
            finalize(pg,CHATS[group],topic,digest,mid,pinned)
            persist(record,{"state":"PUBLISHED","group":group,"topic":topic,
                            "message_id":mid,"pinned":pinned})
            print("NORMAL_TOPIC_PUBLISHED="+group+":"+str(topic)+":"+str(mid)+":PINNED="+str(pinned))
            published+=1
            time.sleep(1.1)
    print("NORMAL_TOPIC_PUBLISHED_GROUP="+group+" COUNT="+str(published))

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("NORMAL_POSTING_REPAIR=FAILED")
        print("NORMAL_POSTING_ERROR="+type(e).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(e).upper())[:100])
        raise SystemExit(1)
