#!/usr/bin/env python3
"""In-place profile-only button repair for the three existing profile forums.
Never delete, resend, or replace existing Bot messages.
Uses the adopted gdm:m_ callback + board_menu_entry_tokens profile route.
"""
from __future__ import annotations
import argparse,base64,hashlib,json,os,re,secrets,subprocess,sys
from pathlib import Path

ROOT=Path("/home/gace/Project/Gserver/projects/TGtumbler/GateApp-Bot")
ADMIN=7880448530
TARGETS=(
 (-1002373696859,1613,"video",(4623,4609,4595)),
 (-1003770334893,210,"category",(1133,1115,1097)),
 (-1003847210571,48,"area",()),
)
LEDGER=ROOT/"deploy/state/profile-topic-only-20261122"

NODE=r"""
'use strict';
const fs=require('node:fs'),https=require('node:https');
const token=fs.readFileSync(process.env.BOT_TOKEN_FILE||'/run/secrets/bot_token','utf8').trim();
const task=__TASK_JSON__;
const agent=new https.Agent({keepAlive:false,family:4,timeout:20000});
function api(method,data){
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(data||{});
  const req=https.request({hostname:'api.telegram.org',port:443,
   path:'/bot'+token+'/'+method,method:'POST',agent,timeout:25000,
   headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
   res=>{
    let b='';
    res.setEncoding('utf8');res.on('data',s=>{if(b.length<20000)b+=s;});
    res.on('end',()=>{
     try{const o=JSON.parse(b);resolve(o.ok===true?{ok:true,result:o.result}:{ok:false,code:Number(o.error_code)||res.statusCode});}
     catch{reject(new Error('API_RESPONSE_INVALID'));}
    });
   });
  req.on('error',()=>reject(new Error('TRANSPORT_UNCERTAIN')));
  req.on('timeout',()=>req.destroy(new Error('TIMEOUT_UNCERTAIN')));
  req.end(body);
 });
}
(async()=>{
 const me=await api('getMe',{});
 if(!me.ok||String(me.result.username).toLowerCase()!=='gaybbs_bot'||me.result.id===8086265383)
  throw new Error('BOT_IDENTITY_MISMATCH');
 if(task.action==='identity'){console.log(JSON.stringify({state:'IDENTITY_PASS'}));return;}
 if(![-1002373696859,-1003770334893,-1003847210571].includes(task.chat_id))
  throw new Error('CHAT_NOT_ALLOWED');
 if(![1613,210,48].includes(task.thread_id))throw new Error('THREAD_NOT_ALLOWED');
 const markup={inline_keyboard:[[{text:'🪪 プロフ投稿',callback_data:task.callback_data}]]};
 if(task.action==='edit'){
  const changed=[];
  for(const id of task.message_ids){
   const r=await api('editMessageReplyMarkup',{chat_id:task.chat_id,message_id:id,reply_markup:markup});
   if(!r.ok){
    console.log(JSON.stringify({state:'PARTIAL',changed,failed:id,code:r.code}));
    process.exitCode=2;return;
   }
   changed.push(id);
  }
  console.log(JSON.stringify({state:'EDITED',changed}));return;
 }
 if(task.action==='send'){
  const r=await api('sendMessage',{chat_id:task.chat_id,message_thread_id:task.thread_id,
   text:'🪪 プロフィールを投稿するには下のボタンをタップしてください。',
   disable_notification:true,reply_markup:markup});
  if(!r.ok){console.log(JSON.stringify({state:'DENIED',code:r.code}));process.exitCode=2;return;}
  const item=r.result||{};
  if(item.chat?.id!==task.chat_id||item.message_thread_id!==task.thread_id||
     !Number.isInteger(item.message_id)||item.message_id<=0)throw new Error('SEND_RECEIPT_UNCERTAIN');
  const pinned=await api('pinChatMessage',{chat_id:task.chat_id,message_id:item.message_id,disable_notification:true});
  console.log(JSON.stringify({state:pinned.ok?'PUBLISHED_PINNED':'PUBLISHED_NOT_PINNED',
   message_id:item.message_id,pinned:pinned.ok}));return;
 }
 throw new Error('ACTION_DENIED');
})().catch(e=>{console.log(JSON.stringify({state:'UNCERTAIN',
 category:String(e?.message||'UNKNOWN').replace(/[^A-Z_]/g,'').slice(0,60)}));process.exitCode=3;});
"""

def run(argv,*,input_data=None,timeout=100):
    p=subprocess.run(argv,input=input_data,text=True,stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL,timeout=timeout)
    return p.returncode,p.stdout

def pg_container():
    code,out=run(["docker","ps","--format","{{.Names}}"])
    names=[x for x in out.splitlines() if re.search("postgres",x,re.I)]
    if code or len(names)!=1:raise RuntimeError("POSTGRES_CONTAINER_NOT_UNIQUE")
    return names[0]

def bot_container():
    code,out=run(["docker","ps","--format","{{.Names}}"])
    names=[x for x in out.splitlines() if re.search("gaybbs",x,re.I)]
    if code or len(names)!=1:raise RuntimeError("GAYBBS_CONTAINER_NOT_UNIQUE")
    return names[0]

def sql(pg,query):
    code,out=run(["docker","exec","-i",pg,"sh","-c",
      'exec psql -X -q -U "$POSTGRES_USER" -d gaybbs -At -F "|" -v ON_ERROR_STOP=1 -f -'],
      input_data=query,timeout=35)
    if code:raise RuntimeError("PROFILE_DB_QUERY_FAILED")
    return [x for x in out.splitlines() if x.strip()]

def bot(c,task):
    js=NODE.replace("__TASK_JSON__",json.dumps(task,ensure_ascii=False))
    code,out=run(["docker","exec","-i",c,"node","-"],input_data=js,timeout=95)
    rows=[x for x in out.splitlines() if x.startswith("{")]
    if len(rows)!=1:raise RuntimeError("PROFILE_BOT_API_REPLY_UNCERTAIN")
    try:r=json.loads(rows[0])
    except json.JSONDecodeError:raise RuntimeError("PROFILE_BOT_API_JSON_UNCERTAIN") from None
    return code,r

def scan(chat,group):
    code,out=run([sys.executable,"scripts/userbot_topic_audit_client.py",
                  "--chat-id",str(chat),"--page","0"],timeout=120)
    if code:raise RuntimeError("PROFILE_USERBOT_AUDIT_FAILED")
    rows=[json.loads(x.split("=",1)[1]) for x in out.splitlines()
          if x.startswith("USERBOT_TOPIC_AUDIT=")]
    if len(rows)!=1 or rows[0].get("chat")!=group:
        raise RuntimeError("PROFILE_USERBOT_GROUP_MISMATCH")
    return {int(r["topic_id"]):r for r in rows[0]["rows"]}

def verify(topic,known,row):
    if not row or "プロフ" not in row.get("title",""):
        raise RuntimeError("PROFILE_TOPIC_TITLE_UNVERIFIED")
    if known:
        if row.get("post_button")!="PRESENT" or "normal" not in row.get("button_types",[]):
            raise RuntimeError("PROFILE_ORIGINAL_BUTTONS_CHANGED")
        if set(row.get("history_message_ids",[]))!=set(known):
            raise RuntimeError("PROFILE_ORIGINAL_MESSAGE_SET_CHANGED")
    elif row.get("post_button")!="ABSENT":
        raise RuntimeError("PROFILE_ALREADY_PRESENT_OR_UNCERTAIN")

def db_readback(pg,chat,topic,known):
    rows=sql(pg,f"""SELECT COUNT(*) FROM posting_topics
      WHERE purpose='profile' AND chat_id={chat} AND message_thread_id={topic}
      AND enabled=TRUE AND verified_at IS NOT NULL;
    SELECT COUNT(*) FROM board_menu_panels
      WHERE chat_id={chat} AND message_thread_id={topic} AND panel_type='posting';""")
    if rows!=["1","0"]:raise RuntimeError("PROFILE_DB_ROUTE_OR_PANEL_CONFLICT")
    pins=sql(pg,f"""SELECT COALESCE(message_id,0),state,pinned FROM topic_dm_entry_pins
      WHERE chat_id={chat} AND message_thread_id={topic};""")
    if known:
        if pins!=[f"{max(known)}|published|t"]:
            raise RuntimeError("PROFILE_ORIGINAL_PIN_LEDGER_CHANGED")
    elif pins:
        raise RuntimeError("PROFILE_UNEXPECTED_PIN_LEDGER")

def persist(path,data):
    next_path=path.with_suffix(".next")
    fd=os.open(next_path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,"w") as f:
        json.dump(data,f,sort_keys=True,ensure_ascii=False);f.flush();os.fsync(f.fileno())
    os.replace(next_path,path)

def main():
    p=argparse.ArgumentParser();p.add_argument("--mode",choices=("dry-run","apply"),required=True)
    args=p.parse_args()
    if Path.cwd().resolve()!=ROOT.resolve():raise RuntimeError("PROFILE_ROOT_MISMATCH")
    pg=pg_container();c=bot_container()
    code,me=bot(c,{"action":"identity"})
    if code or me.get("state")!="IDENTITY_PASS":raise RuntimeError("PROFILE_BOT_IDENTITY_FAILED")
    for chat,topic,group,known in TARGETS:
        row=scan(chat,group).get(topic);verify(topic,known,row)
        db_readback(pg,chat,topic,known)
    print("PROFILE_THREE_TOPICS_PREFLIGHT=PASS")
    if args.mode=="dry-run":return
    LEDGER.mkdir(mode=0o700,parents=True,exist_ok=True)
    for chat,topic,group,known in TARGETS:
        # No second send or edit when an earlier attempt is uncertain.
        path=LEDGER/(str(topic)+".json")
        with os.fdopen(os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
            json.dump({"state":"ATTEMPTING","chat_id":chat,"topic":topic},f)
            f.flush();os.fsync(f.fileno())
        verify(topic,known,scan(chat,group).get(topic))
        db_readback(pg,chat,topic,known)
        token=base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
        if len(token)!=32:raise RuntimeError("PROFILE_TOKEN_LENGTH_INVALID")
        digest=hashlib.sha256(("GayBBS-menu-v1:"+token).encode()).hexdigest()
        state="published" if known else "verified"
        old_message=max(known) if known else "NULL"
        is_pinned="TRUE" if known else "FALSE"
        res=sql(pg,f"""WITH p AS (
           INSERT INTO board_menu_panels(chat_id,message_thread_id,panel_type,message_id,
             pinned,state,verified_by,verified_at)
           VALUES ({chat},{topic},'posting',{old_message},{is_pinned},'{state}',{ADMIN},NOW())
           ON CONFLICT(chat_id,message_thread_id,panel_type) DO NOTHING
           RETURNING panel_id
         ) INSERT INTO board_menu_entry_tokens(token_hash,panel_id,feature,expires_at,enabled)
           SELECT '{digest}',panel_id,'profile',NOW()+INTERVAL '365 days',TRUE FROM p
           RETURNING panel_id;""")
        if len(res)!=1 or not res[0].isdigit():raise RuntimeError("PROFILE_TOKEN_REGISTRATION_FAILED")
        action={"action":"edit" if known else "send","chat_id":chat,
                "thread_id":topic,"callback_data":"gdm:m_"+token}
        if known:action["message_ids"]=list(known)
        code,reply=bot(c,action)
        if code or reply.get("state") not in ("EDITED","PUBLISHED_PINNED","PUBLISHED_NOT_PINNED"):
            persist(path,{"state":reply.get("state","UNCERTAIN"),"chat_id":chat,
                          "topic":topic,"changed":reply.get("changed",[])})
            raise RuntimeError("PROFILE_BUTTON_TELEGRAM_RESULT_UNCERTAIN")
        if not known:
            mid=reply.get("message_id")
            if not isinstance(mid,int) or mid<=0:raise RuntimeError("PROFILE_NEW_MESSAGE_ID_INVALID")
            pinned="TRUE" if reply.get("pinned") else "FALSE"
            saved=sql(pg,f"""UPDATE board_menu_panels SET
              state='published',message_id={mid},pinned={pinned},updated_at=NOW()
              WHERE panel_id={res[0]} AND state='verified' AND message_id IS NULL
              RETURNING panel_id;""")
            if saved!=res:raise RuntimeError("PROFILE_PUBLICATION_DB_FINALIZATION_UNKNOWN")
            ids=[mid]
        else:ids=list(known)
        persist(path,{"state":"PUBLISHED","chat_id":chat,"topic":topic,
                      "message_ids":ids,"panel_id":int(res[0])})
        print("PROFILE_TOPIC_BUTTONS_UPDATED="+str(topic)+":"+(",".join(map(str,ids))))
    print("PROFILE_THREE_TOPICS_PUBLICATION=PASS")

if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("PROFILE_TOPIC_REPAIR=FAILED")
        print("PROFILE_TOPIC_ERROR="+type(exc).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(exc).upper())[:100])
        raise SystemExit(1)
