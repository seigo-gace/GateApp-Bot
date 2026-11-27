#!/usr/bin/env python3
"""One-time creator-topic button repair using existing Bot and resident Userbot.

Only exact Telegram-verified topic IDs. No overwrite/delete of existing posts.
Durable O_EXCL intent prevents a second send after an uncertain result.
"""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT=Path("/home/gace/Project/Gserver/projects/TGtumbler/GateApp-Bot")
CHAT=-1002373696859
TARGETS={1695:"video",4640:"sticker"}
LEDGER=ROOT/"deploy/state/topic-creator-missing-20261122"
URL="https://t.me/CreateVdobot"

NODE_SCRIPT=r"""
'use strict';
const fs=require('node:fs'),https=require('node:https');
const token=fs.readFileSync(process.env.BOT_TOKEN_FILE||'/run/secrets/bot_token','utf8').trim();
const action=process.argv[2],topic=Number(process.argv[3]);
const agent=new https.Agent({keepAlive:false,family:4,timeout:20000});
function api(method,payload){
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(payload||{});
  const req=https.request({hostname:'api.telegram.org',port:443,
   path:'/bot'+token+'/'+method,method:'POST',agent,timeout:25000,
   headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
   res=>{
    let result='';
    res.setEncoding('utf8');
    res.on('data',s=>{if(result.length<20000)result+=s;});
    res.on('end',()=>{
      try{
       const obj=JSON.parse(result);
       if(obj.ok!==true)return resolve({ok:false,code:Number(obj.error_code)||res.statusCode});
       resolve({ok:true,result:obj.result});
      }catch{return reject(new Error('TELEGRAM_RESPONSE_INVALID'));}
    });
   });
  req.on('error',()=>reject(new Error('TELEGRAM_TRANSPORT_UNCERTAIN')));
  req.on('timeout',()=>req.destroy(new Error('TELEGRAM_TIMEOUT_UNCERTAIN')));
  req.end(body);
 });
}
(async()=>{
  const me=await api('getMe',{});
  if(!me.ok||!me.result||String(me.result.username).toLowerCase()!=='gaybbs_bot'||me.result.id===8086265383)
    throw new Error('BOT_IDENTITY_UNVERIFIED');
  if(action==='identity'){
    process.stdout.write(JSON.stringify({state:'IDENTITY_PASS',bot_id:me.result.id})+'\n');
    return;
  }
  if(action!=='send'||![1695,4640].includes(topic))throw new Error('ACTION_NOT_ALLOWED');
  const payload={chat_id:-1002373696859,message_thread_id:topic,
   text:'📝 クリエーター投稿はこちら\n動画・ステッカー・絵文字の登録は下のボタンから進めます。',
   disable_notification:true,
   reply_markup:{inline_keyboard:[[{text:'クリエーター投稿',url:'https://t.me/CreateVdobot'}]]}};
  const r=await api('sendMessage',payload);
  if(!r.ok){
    process.stdout.write(JSON.stringify({state:'DENIED',code:r.code})+'\n');
    process.exitCode=2;
    return;
  }
  if(!r.result||r.result.chat?.id!==-1002373696859||
      !Number.isInteger(r.result.message_id)||r.result.message_id<=0||
      r.result.message_thread_id!==topic){
    throw new Error('TELEGRAM_SEND_UNCERTAIN');
  }
  process.stdout.write(JSON.stringify({state:'PUBLISHED',message_id:r.result.message_id,
   thread_id:r.result.message_thread_id,chat_id:r.result.chat.id})+'\n');
})().catch(e=>{
 process.stdout.write(JSON.stringify({state:'UNCERTAIN',category:String(e?.message||'UNKNOWN').replace(/[^A-Z_]/g,'').slice(0,80)})+'\n');
 process.exitCode=3;
});
"""

def run(argv,*,input_data=None,timeout=90):
    p=subprocess.run(argv,input=input_data,text=True,stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL,timeout=timeout)
    return p.returncode,p.stdout

def container():
    code,out=run(["docker","ps","--format","{{.Names}}"],timeout=20)
    matches=[x for x in out.splitlines() if re.search("gaybbs",x,re.I)]
    if code or len(matches)!=1:raise RuntimeError("BOT_CONTAINER_AMBIGUOUS")
    return matches[0]

def node(container_name,action,thread=0):
    code,out=run(["docker","exec","-i",container_name,"node","-",action,str(thread)],
                 input_data=NODE_SCRIPT,timeout=55)
    lines=[x for x in out.splitlines() if x.startswith("{")]
    if len(lines)!=1:raise RuntimeError("BOT_API_RESULT_UNCERTAIN")
    try:result=json.loads(lines[0])
    except json.JSONDecodeError:raise RuntimeError("BOT_API_RESPONSE_UNCERTAIN") from None
    return code,result

def userbot_rows():
    code,out=run([sys.executable,"scripts/userbot_topic_audit_client.py",
                  "--chat-id",str(CHAT),"--page","0"],timeout=120)
    if code:raise RuntimeError("USERBOT_LIVE_AUDIT_UNAVAILABLE")
    rows=[json.loads(x.split("=",1)[1]) for x in out.splitlines()
          if x.startswith("USERBOT_TOPIC_AUDIT=")]
    if len(rows)!=1:raise RuntimeError("USERBOT_AUDIT_RESULT_MISSING")
    data=rows[0]
    if data.get("chat")!="video" or data.get("total_topics",0)<12:
        raise RuntimeError("USERBOT_FORUM_IDENTITY_UNVERIFIED")
    return {x["topic_id"]:x for x in data["rows"]}

def check_missing(rows,topic):
    row=rows.get(topic)
    if not row:raise RuntimeError("CREATOR_TOPIC_ID_NOT_VERIFIED")
    if row.get("post_button")!="ABSENT" or row.get("history_inspected",0)<1:
        raise RuntimeError("CREATOR_EXISTING_OR_UNKNOWN_BUTTON_PROTECTED")
    if row.get("pin_state")=="INCONCLUSIVE_PIN_PAGE_LIMIT":
        raise RuntimeError("CREATOR_PIN_INSPECTION_UNCERTAIN")
    title=row.get("title","")
    if topic==1695 and "有料動画" not in title:raise RuntimeError("CREATOR_TOPIC_TITLE_CHANGED")
    if topic==4640 and "ステッカー" not in title:raise RuntimeError("CREATOR_TOPIC_TITLE_CHANGED")

def persist(path,payload):
    tmp=path.with_suffix(".next")
    if tmp.exists():raise RuntimeError("CREATOR_LEDGER_CONCURRENT_UPDATE")
    fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,"w") as f:
        json.dump(payload,f,ensure_ascii=False,sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp,path)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("dry-run","apply"),required=True)
    opts=p.parse_args()
    if Path.cwd().resolve()!=ROOT.resolve():raise RuntimeError("CREATOR_SOURCE_ROOT_MISMATCH")
    code,st=run(["systemctl","--user","is-active","gace-userbot-verify.service"])
    if code or st.strip()!="active":raise RuntimeError("RESIDENT_USERBOT_INACTIVE")
    rows=userbot_rows()
    for topic in TARGETS:check_missing(rows,topic)
    c=container()
    code,me=node(c,"identity")
    if code or me.get("state")!="IDENTITY_PASS":raise RuntimeError("BOT_IDENTITY_CHECK_FAILED")
    print("CREATOR_TWO_TOPICS_USERBOT_AND_BOT_PREFLIGHT=PASS")
    if opts.mode=="dry-run":return
    LEDGER.mkdir(mode=0o700,parents=True,exist_ok=True)
    for topic,kind in TARGETS.items():
        path=LEDGER/(str(topic)+".json")
        # Never repeat after any attempt including uncertain network effects.
        with os.fdopen(os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
            json.dump({"chat_id":CHAT,"topic_id":topic,"kind":kind,"state":"ATTEMPTING"},f)
            f.flush();os.fsync(f.fileno())
        # Query Telegram live again immediately before each send.
        row=userbot_rows()
        try:
            check_missing(row,topic)
            code,res=node(c,"send",topic)
            if code or res.get("state")!="PUBLISHED":
                persist(path,{"chat_id":CHAT,"topic_id":topic,
                              "state":res.get("state","UNCERTAIN"),
                              "error_code":res.get("code")})
                raise RuntimeError("CREATOR_SEND_NOT_CONFIRMED")
            persist(path,{"chat_id":CHAT,"topic_id":topic,"kind":kind,
                          "state":"PUBLISHED","message_id":res["message_id"]})
            print("CREATOR_TOPIC_PUBLISHED="+str(topic)+":"+str(res["message_id"]))
        except BaseException:
            # ATTEMPTING or UNCERTAIN record is deliberately not removed.
            raise
    print("CREATOR_TOPIC_BUTTONS_PUBLISHED=2")

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        print("CREATOR_TOPIC_OPERATION=FAILED")
        print("CREATOR_TOPIC_ERROR="+type(exc).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(exc).upper())[:100])
        raise SystemExit(1)
