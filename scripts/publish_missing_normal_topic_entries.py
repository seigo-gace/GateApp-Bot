#!/usr/bin/env python3
"""Add a verified missing standard posting entrance, one time only per topic.

Independent resident Userbot history check immediately before a potential send.
Never delete or edit an existing Telegram message. On uncertain delivery, save
the attempt and stop; do not retry. Uses existing gdm:p_ DM navigation.
"""
from __future__ import annotations
import argparse,base64,hashlib,json,os,re,secrets,subprocess,sys
from pathlib import Path
from verify_missing_normal_topic_entries import FORUMS,live_rows,classify,candidate_status,pg,query

ROOT=Path("/home/gace/Project/Gserver/projects/TGtumbler/GateApp-Bot")
LEDGER=ROOT/"deploy/state/missing-normal-posting-20261122"
ADMIN=7880448530

NODE=r"""
'use strict';
const fs=require('node:fs'),https=require('node:https');
const token=fs.readFileSync(process.env.BOT_TOKEN_FILE||'/run/secrets/bot_token','utf8').trim();
const task=__TASK_JSON__;
const agent=new https.Agent({family:4,keepAlive:false,timeout:20000});
async function api(name,data){
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(data);
  const req=https.request({hostname:'api.telegram.org',port:443,
   path:'/bot'+token+'/'+name,method:'POST',agent,timeout:25000,
   headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
   response=>{
    let data='';
    response.setEncoding('utf8');
    response.on('data',chunk=>{if(data.length<20000)data+=chunk;});
    response.on('end',()=>{
      try{const parsed=JSON.parse(data);
        resolve(parsed.ok===true?{ok:true,result:parsed.result}:{ok:false,code:Number(parsed.error_code)||response.statusCode});
      }catch{reject(new Error('RESPONSE_INVALID'));}
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
   throw new Error('BOT_IDENTITY_INVALID');
 if(task.mode==='identity'){console.log(JSON.stringify({state:'IDENTITY_PASS'}));return;}
 if(task.mode!=='send'||!Number.isInteger(task.thread_id)||task.thread_id<1)
  throw new Error('ACTION_NOT_ADMITTED');
 if(![-1003847210571,-1002373696859,-1003770334893].includes(task.chat_id))
  throw new Error('CHAT_NOT_ADMITTED');
 const p={chat_id:task.chat_id,message_thread_id:task.thread_id,
  text:'📝 このトピックへの投稿はこちら\n下のボタンからBotの投稿メニューを開いてください。',
  disable_notification:true,
  reply_markup:{inline_keyboard:[[{text:'📝 投稿メニューを開く',
   callback_data:task.callback_data}]]}};
 const sent=await api('sendMessage',p);
 if(!sent.ok){console.log(JSON.stringify({state:'DENIED',code:sent.code}));process.exitCode=2;return;}
 const item=sent.result||{};
 if(item.chat?.id!==task.chat_id||!Number.isInteger(item.message_id)||item.message_id<1||
   (item.message_thread_id!==task.thread_id && !(task.thread_id===1 && item.message_thread_id==null)))
   throw new Error('MESSAGE_ACK_UNCERTAIN');
 const pin=await api('pinChatMessage',{chat_id:task.chat_id,message_id:item.message_id,
  disable_notification:true});
 console.log(JSON.stringify({state:pin.ok?'PUBLISHED_PINNED':'PUBLISHED_PIN_UNCERTAIN',
  message_id:item.message_id,chat_id:task.chat_id,thread_id:task.thread_id}));
})().catch(e=>{
 console.log(JSON.stringify({state:'UNCERTAIN',
  error:String(e?.message||'UNKNOWN').replace(/[^A-Z_]/g,'').slice(0,70)}));process.exitCode=3;
});
"""

def bot():
    p=subprocess.run(["docker","ps","--format","{{.Names}}"],
                     capture_output=True,text=True,timeout=30)
    names=[x for x in p.stdout.splitlines() if "gaybbs" in x.lower()]
    if p.returncode or len(names)!=1:
        raise RuntimeError("BOT_CONTAINER_NOT_UNIQUE")
    return names[0]

def sender(container,task):
    p=subprocess.run(["docker","exec","-i",container,"node","-"],
                     input=NODE.replace("__TASK_JSON__",json.dumps(task,ensure_ascii=False)),
                     capture_output=True,text=True,timeout=95)
    lines=[x for x in p.stdout.splitlines() if x.startswith("{")]
    if len(lines)!=1:raise RuntimeError("BOT_RESULT_UNCERTAIN")
    try:obj=json.loads(lines[0])
    except json.JSONDecodeError:raise RuntimeError("BOT_RESULT_PARSE_UNCERTAIN") from None
    return p.returncode,obj

def escape(value):
    return value.replace("'","''")

def persist(path,value):
    next_file=path.with_suffix(".next")
    fd=os.open(next_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,"w") as f:
        json.dump(value,f,ensure_ascii=False,sort_keys=True)
        f.flush();os.fsync(f.fileno())
    os.replace(next_file,path)

def candidate_ready(pg_name,group,chat,thread,expected):
    row=live_rows(chat,group,thread)
    first=classify(row,expected)
    if first!="MISSING_CONFIRMED":
        return first,row
    return candidate_status(pg_name,chat,thread,row),row

def run(args):
    if Path.cwd().resolve()!=ROOT.resolve():
        raise RuntimeError("NORMAL_ENTRY_WRONG_ROOT")
    c=bot();db=pg()
    code,me=sender(c,{"mode":"identity"})
    if code or me.get("state")!="IDENTITY_PASS":
        raise RuntimeError("BOT_IDENTITY_NOT_VERIFIED")
    if args.mode=="apply":
        LEDGER.mkdir(mode=0o700,parents=True,exist_ok=True)
    for group,(chat,candidates) in FORUMS.items():
        for thread,expected in candidates:
            status,row=candidate_ready(db,group,chat,thread,expected)
            print("NORMAL_TOPIC_CANDIDATE="+group+":"+str(thread)+":"+status)
            if status!="READY_FOR_SINGLE_ENTRY" or args.mode=="dry-run":
                continue
            file=LEDGER/(str(chat)+"-"+str(thread)+".json")
            with os.fdopen(os.open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),"w") as f:
                json.dump({"state":"ATTEMPTING","chat_id":chat,"topic_id":thread},f)
                f.flush();os.fsync(f.fileno())
            # Reverify immediately before the first database and Telegram effects.
            rechecked,fresh=candidate_ready(db,group,chat,thread,expected)
            if rechecked!="READY_FOR_SINGLE_ENTRY":
                persist(file,{"state":"SKIPPED_CHANGING_LIVE_STATE","topic_id":thread})
                raise RuntimeError("NORMAL_ENTRY_LIVE_STATE_CHANGED")
            token=base64.urlsafe_b64encode(secrets.token_bytes(24)).decode().rstrip("=")
            if len(token)!=32:raise RuntimeError("NORMAL_TOKEN_LENGTH_INVALID")
            digest=hashlib.sha256(("GayBBS-menu-v1:"+token).encode()).hexdigest()
            title=escape(str(fresh["title"]))
            taken=query(db,f"""INSERT INTO topic_dm_entry_pins(
              chat_id,message_thread_id,title,token_hash,verified_by,state,pinned)
             VALUES ({chat},{thread},'{title}','{digest}',{ADMIN},'publishing',FALSE)
             ON CONFLICT(chat_id,message_thread_id) DO UPDATE SET
               token_hash=EXCLUDED.token_hash,title=EXCLUDED.title,state='publishing'
             WHERE topic_dm_entry_pins.state='verified'
               AND topic_dm_entry_pins.message_id IS NULL AND pinned=FALSE
             RETURNING chat_id;""")
            if taken!=[str(chat)]:
                persist(file,{"state":"PIN_LEDGER_CLAIM_BLOCKED","topic_id":thread})
                raise RuntimeError("PIN_LEDGER_CLAIM_NOT_CONFIRMED")
            try:
                code,result=sender(c,{"mode":"send","chat_id":chat,
                                     "thread_id":thread,"callback_data":"gdm:p_"+token})
                message_id=result.get("message_id")
                if not isinstance(message_id,int) or message_id<1:
                    query(db,f"""UPDATE topic_dm_entry_pins SET state='needs_reconcile'
                     WHERE chat_id={chat} AND message_thread_id={thread}
                       AND token_hash='{digest}' AND state='publishing';""")
                    persist(file,{"state":result.get("state","UNCERTAIN"),"topic_id":thread})
                    raise RuntimeError("TELEGRAM_POST_UNKNOWN_OR_DENIED")
                if code or result.get("state")!="PUBLISHED_PINNED":
                    query(db,f"""UPDATE topic_dm_entry_pins
                      SET message_id={message_id},state='needs_reconcile'
                      WHERE chat_id={chat} AND message_thread_id={thread}
                        AND token_hash='{digest}' AND state='publishing';""")
                    persist(file,{"state":"PUBLISHED_BUT_PIN_UNCONFIRMED",
                                  "topic_id":thread,"message_id":message_id})
                    raise RuntimeError("TELEGRAM_PIN_NOT_CONFIRMED")
                done=query(db,f"""UPDATE topic_dm_entry_pins SET message_id={message_id},
                  pinned=TRUE,state='published',updated_at=NOW()
                  WHERE chat_id={chat} AND message_thread_id={thread}
                    AND token_hash='{digest}' AND state='publishing'
                  RETURNING message_id;""")
                if done!=[str(message_id)]:
                    persist(file,{"state":"DB_FINALIZATION_UNCERTAIN","topic_id":thread,
                                  "message_id":message_id})
                    raise RuntimeError("DB_FINALIZATION_UNKNOWN")
                persist(file,{"state":"PUBLISHED","topic_id":thread,
                              "chat_id":chat,"message_id":message_id})
                print("NORMAL_TOPIC_PUBLISHED="+group+":"+str(thread)+":"+str(message_id))
            except BaseException:
                raise
    print("NORMAL_TOPIC_RECONCILIATION=FINISHED_NO_DUPLICATES")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--mode",choices=("dry-run","apply"),required=True)
    args=parser.parse_args()
    try:run(args)
    except Exception as exc:
        print("NORMAL_TOPIC_RECONCILIATION=FAILED")
        print("NORMAL_TOPIC_ERROR="+type(exc).__name__+"_"+re.sub("[^A-Z0-9_]","_",str(exc).upper())[:90])
        raise SystemExit(1)
