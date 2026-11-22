#!/usr/bin/env python3
"""Readback of exact existing published normal posting entries.

Must match Telegram message ID, actual callback classification, and database pin.
Read-only; no repair or send from this script.
"""
import argparse,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import publish_missing_normal_topic_buttons as n

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--group',required=True,choices=n.CHATS)
    p.add_argument('--page',type=int,default=None)
    x=p.parse_args()
    pg=n.unique_container('postgres')
    total=0
    for page,topics in n.TARGETS[x.group].items():
        if x.page is not None and page!=x.page:continue
        for topic in topics:
            record=n.LEDGER/x.group/(str(topic)+'.json')
            if not record.is_file():raise RuntimeError("POST_LEDGER_MISSING")
            r=json.loads(record.read_text())
            if r.get('state')!='PUBLISHED' or r.get('pinned') is not True:
                raise RuntimeError("POST_NOT_FULLY_PINNED")
            msg=r.get('message_id')
            if not isinstance(msg,int) or msg<1:
                raise RuntimeError("POST_MESSAGE_ID_INVALID")
            live=n.resolve_topic(x.group,page,topic)
            if (live.get('post_button')!='PRESENT' or
                'normal' not in live.get('button_types',[]) or
                msg not in live.get('history_message_ids',[])+live.get('pin_message_ids',[])):
                raise RuntimeError("LIVE_BUTTON_ID_MISMATCH")
            rows=n.db_query(pg,f"""SELECT message_id,state,pinned FROM topic_dm_entry_pins
             WHERE chat_id={n.CHATS[x.group]} AND message_thread_id={topic};""")
            if rows!=[str(msg)+'|published|t']:
                raise RuntimeError("POST_PIN_LEDGER_MISMATCH")
            print("NORMAL_TOPIC_LIVE_VERIFIED="+x.group+":"+str(topic)+":"+str(msg))
            total+=1
    print("NORMAL_GROUP_ALL_LIVE_VERIFIED="+x.group+" COUNT="+str(total))

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print("NORMAL_READBACK=FAILED")
        print("NORMAL_READBACK_ERROR="+type(exc).__name__+"_"+re.sub('[^A-Z0-9_]','_',str(exc).upper())[:100])
        raise SystemExit(1)
