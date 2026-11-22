#!/usr/bin/env python3
"""Repair only four EXISTING pinned posting entrances in place.

Never sends a new group message. Existing Telegram message IDs and all unrelated
posts are immutable. A transport-uncertain edit stops; no retry without readback.
"""
from __future__ import annotations
import argparse,base64,hashlib,json,os,re,secrets,subprocess,sys

from pathlib import Path
ROOT=Path("/home/gace/Project/Gserver/projects/TGtumbler/GateApp-Bot")
TARGETS={
 "area273":(-1003847210571,273,9,"area",1604),
 "video1724":(-1002373696859,1724,1,"video",4659),
 "video4291":(-1002373696859,4291,1,"video",4633),
 "category18":(-1003770334893,18,1,"category",1146),
}
LEDGER=ROOT/"deploy/state/existing-normal-pin-repair-20261122"
NODE=r"""
'use strict';
const fs=require('node:fs'),https=require('node:https');
const task=__TASK_JSON__;
const token=fs.readFileSync(process.env.BOT_TOKEN_FILE||'/run/secrets/bot_token','utf8').trim();
const agent=new https.Agent({keepAlive:false,family:4,timeout:20000});
function api(method,data){
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(data||{});
  const req=https.request({hostname:'api.telegram.org',port:443,
    path:'/bot'+token+'/'+method,method:'POST',agent,timeout:25000,
    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
   res=>{
    let s='';res.setEncoding('utf8');
    res.on('data',x=>{if(s.length<20000)s+=x;});
    res.on('end',()=>{try{const d=JSON.parse(s);resolve(d.ok===true?{ok:true}:{ok:false,code:d.error_code});}
    catch{reject(Error('RESPONSE_UNCERTAIN'));}});
   });
  req.on('error',()=>reject(Error('TRANSPORT_UNCERTAIN')));
  req.on('timeout',()=>req.destroy(Error('TIMEOUT_UNCERTAIN')));
  req.end(body);
 });
}
(async()=>{
 const me=await api('getMe',{});
 if(!me.ok||String(me.value?.username||'').toLowerCase()!=='gaybbs_bot'||me.value.id===8086265383)throw Error('BOT_AUTH_UNVERIFIED');
 if(task.action==='identity'){console.log(JSON.stringify({state:'IDENTITY_PASS'}));return;}
 if(task.action!=='edit'||!task.callback_data.startsWith('gdm:p_'))
  throw Error('ACTION_DENIED');
 const reply_markup={inline_keyboard:[[{text:'📝 投稿メニューを開く',
  callback_data:task.callback_data}]]};
 const r=await api('editMessageReplyMarkup',{chat_id:task.chat_id,
   message_id:task.message_id,reply_markup});
 console.log(JSON.stringify(r.ok?{state:'EDITED'}:{state:'DENIED',code:r.code}));
 if(!r.ok)process.exitCode=2;
})().catch(e=>{console.log(JSON.stringify({state:'UNCERTAIN',
 category:String(e?.message||'UNKNOWN').replace(/[^A-Z_]/g,'').slice(0,60)}));process.exitCode=3;});
"""
def run(a,data=None,timeout=125):
    p=subprocess.run(a,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout)
    return p.returncode,p.stdout
def container(pattern):
    code,out=run(["docker","ps","--format","{{.Names}}"])
    a=[x for x in out.splitlines() if re.search(pattern,x,re.I)]
    if code or len(a)!=1:raise RuntimeError("CONTAINER_UNVERIFIED")
    return a[0]
def db(pg,sql):
    code,out=run(["docker","exec","-i",pg,"sh","-c",
       'exec psql -X -q -U "$POSTGRES_USER" -d gaybbs -At -F "|" -v ON_ERROR_STOP=1 -f -'],sql,40)
    if code:raise RuntimeError("POSTGRES_QUERY_FAILED")
    return [x.strip() for x in out.splitlines() if x.strip()]
def live(group,chat,page,topic):
    code,out=run([sys.executable,"scripts/userbot_topic_audit_client.py",
       "--chat-id",str(chat),"--topic-id",str(topic)],timeout=120)
    if code:raise RuntimeError("USERBOT_AUDIT_FAILED")
    r=[json.loads(x.split("=",1)[1]) for x in out.splitlines()
       if x.startswith("USERBOT_TOPIC_AUDIT=")]
    if len(r)!=1 or r[0].get("chat")!=group:raise RuntimeError("USERBOT_GROUP_INVALID")
    a=[x for x in r[0]["rows"] if x["topic_id"]==topic]
    if len(a)!=1 or a[0].get("post_button")!="ABSENT":
        raise RuntimeError("EXISTING_POST_OR_UNCERTAIN_PROTECTED")
    return a[0]
def identity(bot,task):
    code,out=run(["docker","exec","-i",bot,"node","-"],
       NODE.replace("__TASK_JSON__",json.dumps(task)),75)
    a=[x for x in out.splitlines() if x.startswith("{")]
    if len(a)!=1:raise RuntimeError("BOT_RESULT_UNCERTAIN")
    return code,json.loads(a[0])
def check_db(pg,chat,topic,message):
    a=db(pg,f"""SELECT message_id,state,pinned,token_hash FROM topic_dm_entry_pins
       WHERE chat_id={chat} AND message_thread_id={topic};""")
    if len(a)!=1:raise RuntimeError("EXISTING_PIN_MISSING")
    id,state,pinned,oldhash=a[0].split("|")
    if id!=str(message) or state!="published" or pinned!="t" or not re.fullmatch("[a-f0-9]{64}",oldhash):
        raise RuntimeError("EXISTING_PIN_CHANGED")
    return oldhash
def persist(path,record):
    temp=path.with_suffix(".next")
    with os.fdopen(os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
        json.dump(record,f);f.flush();os.fsync(f.fileno())
    os.replace(temp,path)
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("dry-run","apply"),required=True)
    p.add_argument("--target",choices=TARGETS,required=True)
    x=p.parse_args()
    if Path.cwd().resolve()!=ROOT.resolve():raise RuntimeError("ROOT_INVALID")
    chat,topic,page,group,message=TARGETS[x.target]
    code,svc=run(["systemctl","--user","is-active","gace-userbot-verify.service"])
    if code or svc.strip()!="active":raise RuntimeError("RESIDENT_USERBOT_INACTIVE")
    pg=container("postgres");bot=container("gaybbs")
    code,me=identity(bot,{"action":"identity"})
    if code or me.get("state")!="IDENTITY_PASS":raise RuntimeError("BOT_NOT_READY")
    live(group,chat,page,topic)
    oldhash=check_db(pg,chat,topic,message)
    path=LEDGER/(x.target+".json")
    if path.exists():raise RuntimeError("PREVIOUS_EDIT_ATTEMPT_PROTECTED")
    print("EXISTING_PIN_PREFLIGHT=PASS "+x.target)
    if x.mode=="dry-run":return
    LEDGER.mkdir(parents=True,mode=0o700,exist_ok=True)
    with os.fdopen(os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
        json.dump({"state":"ATTEMPTING","target":x.target},f);f.flush();os.fsync(f.fileno())
    live(group,chat,page,topic)
    if check_db(pg,chat,topic,message)!=oldhash:raise RuntimeError("CONCURRENT_CHANGE")
    token=base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
    if len(token)!=32:raise RuntimeError("TOKEN_INVALID")
    newhash=hashlib.sha256(("GayBBS-menu-v1:"+token).encode()).hexdigest()
    code,result=identity(bot,{"action":"edit","chat_id":chat,"message_id":message,
                              "callback_data":"gdm:p_"+token})
    if code or result.get("state")!="EDITED":
        persist(path,{"state":result.get("state","UNKNOWN"),"target":x.target})
        raise RuntimeError("EXISTING_MESSAGE_NOT_EDITABLE")
    saved=db(pg,f"""BEGIN;
      DELETE FROM topic_dm_entry_sessions WHERE token_hash='{oldhash}';
      UPDATE topic_dm_entry_pins SET token_hash='{newhash}',updated_at=NOW()
      WHERE chat_id={chat} AND message_thread_id={topic} AND message_id={message}
      AND token_hash='{oldhash}' AND state='published' AND pinned=TRUE
      RETURNING message_id;
      COMMIT;""")
    if saved!=[str(message)]:
        raise RuntimeError("DB_RECONCILE_UNKNOWN_AFTER_TELEGRAM_EDIT")
    persist(path,{"state":"EDITED","target":x.target,"message_id":message})
    print("EXISTING_NORMAL_PIN_EDITED="+x.target+":"+str(message))
if __name__=="__main__":
    try:main()
    except Exception as e:
        print("EXISTING_NORMAL_REPAIR=FAILED")
        print("EXISTING_NORMAL_ERROR="+type(e).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(e).upper())[:100])
        raise SystemExit(1)
