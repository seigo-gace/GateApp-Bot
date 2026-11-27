#!/usr/bin/env python3
"""In-place replacement of 10 Userbot-verified repeated Start topic entrances.

No new Telegram messages, no deletes, no separate Userbot sessions.
One attempt per exact message ID, with durable proof and no unsafe retries.
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

ROOT = Path("/home/gace/Project/Gserver/projects/TGtumbler/GateApp-Bot")
CHAT = -1003847210571
TARGETS = {102:1494,104:1496,116:1498,1000:1500,
           81:1502,92:1504,103:1506,50:1526,51:1529,52:1532}
LEDGER = ROOT/"deploy/state/startless-repeated-start-repairs-20261122"

NODE = r"""
'use strict';
const fs=require('node:fs'),https=require('node:https');
const task=__TASK__;
const token=fs.readFileSync(process.env.BOT_TOKEN_FILE||'/run/secrets/bot_token','utf8').trim();
const agent=new https.Agent({keepAlive:false,family:4,timeout:20000});
async function api(method,params){
 const body=JSON.stringify(params||{});
 return await new Promise((resolve,reject)=>{
  const req=https.request({hostname:'api.telegram.org',port:443,
   path:'/bot'+token+'/'+method,method:'POST',agent,timeout:25000,
   headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
   res=>{
    let out='';
    res.setEncoding('utf8');res.on('data',chunk=>{if(out.length<15000)out+=chunk;});
    res.on('end',()=>{
     try{
      const parsed=JSON.parse(out);
      resolve(parsed.ok===true?{ok:true,value:parsed.result}:
       {ok:false,code:Number(parsed.error_code)||res.statusCode,
        reason:String(parsed.description||'DENIED').replace(/[^a-zA-Z0-9_ -]/g,'').slice(0,140)});
     }catch{reject(Error('API_RESPONSE_UNCERTAIN'));}
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
 if(task.action==='identity'){
  console.log(JSON.stringify({state:'IDENTITY_PASS'}));return;
 }
 if(task.action!=='edit'||task.chat_id!==-1003847210571||
   !Number.isInteger(task.message_id)||task.message_id<=0||
   !/^gdm:p_[A-Za-z0-9_-]{32}$/.test(task.callback_data))
  throw Error('TARGET_NOT_ALLOWED');
 const reply_markup={inline_keyboard:[[
  {text:'📝 投稿メニューを開く',callback_data:task.callback_data,style:'primary'}
 ]]};
 const r=await api('editMessageReplyMarkup',{
  chat_id:task.chat_id,message_id:task.message_id,reply_markup
 });
 console.log(JSON.stringify(r.ok?{state:'EDITED'}:
  {state:'DENIED',code:r.code,reason:r.reason}));
 if(!r.ok)process.exitCode=2;
})().catch(e=>{
 console.log(JSON.stringify({state:'UNCERTAIN',
  category:String(e?.message||'UNKNOWN').replace(/[^A-Z_]/g,'').slice(0,70)}));
 process.exitCode=3;
});
"""

def run(args,stdin=None,timeout=125):
    p=subprocess.run(args,input=stdin,text=True,stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL,timeout=timeout,check=False)
    return p.returncode,p.stdout

def container(fragment):
    code,out=run(["docker","ps","--format","{{.Names}}"],timeout=20)
    matched=[n for n in out.splitlines() if fragment in n.lower()]
    if code or len(matched)!=1:
        raise RuntimeError("CONTAINER_NOT_UNIQUE")
    return matched[0]

def db(pg,sql):
    code,out=run(["docker","exec","-i",pg,"sh","-c",
      'exec psql -X -q -U "$POSTGRES_USER" -d gaybbs -At -F "|" -v ON_ERROR_STOP=1 -f -'],
      stdin=sql,timeout=40)
    if code:raise RuntimeError("DATABASE_OPERATION_FAILED")
    return [x.strip() for x in out.splitlines() if x.strip()]

def bot(bot_container,task):
    payload=NODE.replace("__TASK__",json.dumps(task,ensure_ascii=False))
    code,out=run(["docker","exec","-i",bot_container,"node","-"],stdin=payload,timeout=60)
    items=[x for x in out.splitlines() if x.startswith("{")]
    if len(items)!=1:raise RuntimeError("TELEGRAM_API_RESULT_UNKNOWN")
    return code,json.loads(items[0])

def audit(topic):
    code,out=run([sys.executable,"scripts/userbot_topic_audit_client.py",
                  "--chat-id",str(CHAT),"--topic-id",str(topic)],timeout=125)
    if code:raise RuntimeError("USERBOT_CURRENT_MESSAGE_UNAVAILABLE")
    a=[json.loads(x.split("=",1)[1]) for x in out.splitlines()
       if x.startswith("USERBOT_TOPIC_AUDIT=")]
    if len(a)!=1 or a[0].get("chat")!="area" or len(a[0].get("rows",[]))!=1:
        raise RuntimeError("USERBOT_CURRENT_TOPIC_UNVERIFIED")
    row=a[0]["rows"][0]
    m=row.get("migration")
    if row.get("topic_id")!=topic or not isinstance(m,dict) or m.get("message_id")!=TARGETS[topic]:
        raise RuntimeError("USERBOT_MESSAGE_MISMATCH")
    return m["transport"]

def state(pg,topic,mid):
    rows=db(pg,f"""SELECT p.message_id,p.state,p.pinned,p.token_hash,m.state
       FROM topic_dm_entry_pins p JOIN startless_public_post_migrations m
         ON m.kind='topic' AND m.chat_id=p.chat_id
         AND m.message_id=p.message_id AND m.identity=(p.chat_id::text||':'||p.message_thread_id::text)
       WHERE p.chat_id={CHAT} AND p.message_thread_id={topic};""")
    if len(rows)!=1:raise RuntimeError("PIN_STATE_NOT_UNIQUE")
    parts=rows[0].split("|")
    if (len(parts)!=5 or parts[0]!=str(mid) or parts[1]!="published" or
        parts[2]!="t" or not re.fullmatch("[a-f0-9]{64}",parts[3]) or parts[4]!="uncertain"):
        raise RuntimeError("PIN_STATE_NOT_REPAIRABLE")
    return parts[3]

def save(path,data):
    tmp=path.with_suffix(".next")
    with os.fdopen(os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
        json.dump(data,f,ensure_ascii=False,sort_keys=True)
        f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--mode",choices=("dry-run","apply"),required=True)
    ap.add_argument("--topic-id",type=int,choices=sorted(TARGETS),required=True)
    args=ap.parse_args()
    topic=args.topic_id;mid=TARGETS[topic]
    if Path.cwd().resolve()!=ROOT.resolve():raise RuntimeError("PROJECT_ROOT_MISMATCH")
    code,active=run(["systemctl","--user","is-active","gace-userbot-verify.service"])
    if code or active.strip()!="active":raise RuntimeError("RESIDENT_USERBOT_INACTIVE")
    pg=container("postgres");b=container("gaybbs")
    code,identity=bot(b,{"action":"identity"})
    if code or identity.get("state")!="IDENTITY_PASS":
        raise RuntimeError("CURRENT_BOT_NOT_VERIFIED")
    if audit(topic)!="REPEATED_START_DEEPLINK":
        raise RuntimeError("SOURCE_NO_LONGER_HAS_REPEATED_START")
    old_hash=state(pg,topic,mid)
    path=LEDGER/(str(topic)+".json")
    if path.exists():raise RuntimeError("PREVIOUS_REPAIR_ATTEMPT_PROTECTED")
    print("STARTLESS_EXACT_REPAIR_PREFLIGHT=PASS topic="+str(topic))
    if args.mode=="dry-run":return
    LEDGER.mkdir(parents=True,mode=0o700,exist_ok=True)
    with os.fdopen(os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
        json.dump({"state":"ATTEMPTING","topic":topic,"message_id":mid},f)
        f.flush();os.fsync(f.fileno())
    if audit(topic)!="REPEATED_START_DEEPLINK" or state(pg,topic,mid)!=old_hash:
        raise RuntimeError("CONCURRENT_PUBLIC_MESSAGE_CHANGE")
    token=base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
    if len(token)!=32:raise RuntimeError("NEW_OPAQUE_TOKEN_INVALID")
    digest=hashlib.sha256(("GayBBS-menu-v1:"+token).encode()).hexdigest()
    code,reply=bot(b,{"action":"edit","chat_id":CHAT,"message_id":mid,
                      "callback_data":"gdm:p_"+token})
    if code or reply.get("state")!="EDITED":
        save(path,{"state":reply.get("state","UNCERTAIN"),"topic":topic,
                   "message_id":mid,"code":reply.get("code"),
                   "reason":reply.get("reason")})
        raise RuntimeError("TELEGRAM_ORIGINAL_MESSAGE_EDIT_REJECTED")
    result=db(pg,f"""BEGIN;
      DELETE FROM topic_dm_entry_sessions WHERE token_hash='{old_hash}';
      UPDATE topic_dm_entry_pins SET token_hash='{digest}',updated_at=NOW()
      WHERE chat_id={CHAT} AND message_thread_id={topic}
        AND message_id={mid} AND token_hash='{old_hash}' AND pinned=TRUE
        AND state='published' RETURNING message_id;
      UPDATE startless_public_post_migrations SET state='applied',updated_at=NOW()
      WHERE kind='topic' AND chat_id={CHAT} AND identity='{CHAT}:{topic}'
        AND message_id={mid} AND state='uncertain' RETURNING message_id;
      COMMIT;""")
    if result!=[str(mid),str(mid)]:
        raise RuntimeError("POST_EDIT_DATABASE_RECONCILIATION_UNKNOWN")
    after=audit(topic)
    save(path,{"state":"VERIFIED" if after=="INTERNAL_CALLBACK" else "UNKNOWN",
               "topic":topic,"message_id":mid,"transport":after})
    if after!="INTERNAL_CALLBACK":
        raise RuntimeError("TELEGRAM_POST_EDIT_READBACK_INCONCLUSIVE")
    print("STARTLESS_ORIGINAL_MESSAGE_FIXED="+str(topic)+":"+str(mid))
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("STARTLESS_REPAIR=FAILED")
        print("STARTLESS_REPAIR_REASON="+type(exc).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(exc).upper())[:110])
        raise SystemExit(1)
