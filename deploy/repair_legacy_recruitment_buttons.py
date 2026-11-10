#!/usr/bin/env python3
"""One-off, owner-scoped repair of posted recruitment URL buttons.

Only replace existing GayBBS application deep links with the posting owner's
current public Telegram username. Never repost, delete, or change message text.
Both the Telegram edit and SQL receipt must succeed to count as repaired.
No IDs, Telegram usernames, or credentials are written to stdout.
"""
import argparse
import base64
import json
import re
import subprocess
import sys

LEGACY = re.compile(r"^https://t\.me/GayBBS_bot\?start=a_[A-Za-z0-9_-]+$", re.I)
QUERY = """
SELECT row_to_json(x)::text
FROM (
 SELECT d.delivery_id, d.owner_user_id, d.telegram_message_id,
        t.chat_id, d.inline_buttons
 FROM posting_deliveries d
 JOIN announcement_posts a
   ON d.source_type='announcement'
  AND d.source_id=a.announcement_id::text
  AND d.owner_user_id=a.owner_user_id
 JOIN posting_topics t ON t.topic_id=d.posting_topic_id
 WHERE a.kind='recruitment' AND a.status='published'
   AND d.status='sent'
   AND d.telegram_message_id IS NOT NULL
   AND d.inline_buttons::text LIKE '%?start=a_%'
 ORDER BY d.delivery_id
 LIMIT 500
) x
"""
NODE = r"""
import fs from "node:fs";
const tokenPath=process.env.BOT_TOKEN_FILE;
if(!tokenPath || !tokenPath.startsWith("/run/secrets/")) process.exit(81);
const token=fs.readFileSync(tokenPath,"utf8").trim();
const body=fs.readFileSync(0,"utf8");
const rows=JSON.parse(body);
const probe=process.argv.includes("probe");
async function api(method,payload){
 const res=await fetch("https://api.telegram.org/bot"+token+"/"+method,{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(22000)
 });
 const value=await res.json();
 if(!value.ok)throw new Error("TELEGRAM_API_"+String(value.error_code||res.status));
 return value.result;
}
const me=await api("getMe",{});
if(me.id!==8872855519)process.exit(82);
const out=[];
const legacy=/^https:\/\/t\.me\/GayBBS_bot\?start=a_[A-Za-z0-9_-]+$/i;
for(const row of rows){
 let status="skipped",buttons=null;
 try{
  const chat=await api("getChat",{chat_id:row.owner_user_id});
  const username=chat?.username;
  if(typeof username!=="string"||!/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username))
    throw new Error("USERNAME_NOT_AVAILABLE");
  const url="https://t.me/"+username.replace(/^@/,"");
  if(!Array.isArray(row.inline_buttons)||!row.inline_buttons.every(a=>Array.isArray(a)))
    throw new Error("BUTTON_SHAPE_UNVERIFIED");
  buttons=row.inline_buttons.map(a=>a.map(b=>
    b&&typeof b==="object"&&!Array.isArray(b)&&typeof b.url==="string"&&legacy.test(b.url)
      ? {...b,url} : b));
  if(JSON.stringify(buttons)===JSON.stringify(row.inline_buttons))
    throw new Error("NO_MATCHING_BUTTON");
  if(probe){status="ready"; buttons=null;out.push({delivery_id:row.delivery_id,status,buttons});continue;}
  await api("editMessageReplyMarkup",{
    chat_id:row.chat_id,message_id:row.telegram_message_id,
    reply_markup:{inline_keyboard:buttons}
  });
  status="updated";
 }catch(e){
  const error=String(e?.message||"UNKNOWN");
  status=error.startsWith("TELEGRAM_API_")?"telegram_rejected"
    :error==="USERNAME_NOT_AVAILABLE"?"username_missing"
    :error==="BUTTON_SHAPE_UNVERIFIED"?"button_shape_invalid":"skipped";
  buttons=null;
 }
 out.push({delivery_id:row.delivery_id,status,buttons});
}
process.stdout.write(JSON.stringify(out));
"""

def psql(query):
    process = subprocess.run(
        ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace",
         "-d", "gaybbs", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
         "-c", query],
        text=True, capture_output=True, check=False, timeout=30)
    if process.returncode:
        raise RuntimeError("PSQL_EXECUTION_FAILED")
    return process.stdout.strip()

def updated_keyboard(old, new):
    if not isinstance(old, list) or not isinstance(new, list) or len(old)!=len(new):
        return False
    changed = 0
    for original_row, new_row in zip(old,new):
        if not isinstance(original_row,list) or not isinstance(new_row,list) or len(original_row)!=len(new_row):
            return False
        for original, item in zip(original_row,new_row):
            if not isinstance(original,dict) or not isinstance(item,dict):
                return False
            if LEGACY.fullmatch(str(original.get("url",""))):
                if {k:v for k,v in original.items() if k!="url"} != {k:v for k,v in item.items() if k!="url"}:
                    return False
                if not re.fullmatch(r"https://t\.me/[A-Za-z][A-Za-z0-9_]{4,31}", str(item.get("url",""))):
                    return False
                changed+=1
            elif item!=original:
                return False
    return changed>0

def as_sql_json(value):
    encoded=base64.b64encode(json.dumps(value,ensure_ascii=False,separators=(",",":")).encode()).decode()
    return "convert_from(decode('"+encoded+"','base64'),'UTF8')::jsonb"

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--probe", action="store_true")
    args=parser.parse_args()
    rows=[json.loads(line) for line in psql(QUERY).splitlines() if line.strip()]
    candidates=[]
    for row in rows:
        if (not isinstance(row.get("delivery_id"),int)
            or not isinstance(row.get("owner_user_id"),int)
            or not isinstance(row.get("telegram_message_id"),int)
            or not isinstance(row.get("chat_id"),int)
            or row["delivery_id"]<=0 or row["owner_user_id"]<=0
            or row["telegram_message_id"]<=0 or row["chat_id"]>=0
            or not isinstance(row.get("inline_buttons"),list)):
            raise RuntimeError("POSTING_RECEIPT_UNVERIFIED")
        legacy_count=sum(1 for group in row["inline_buttons"] if isinstance(group,list)
                         for b in group if isinstance(b,dict)
                         and LEGACY.fullmatch(str(b.get("url",""))))
        if legacy_count==0:raise RuntimeError("LEGACY_MATCH_SHAPE_MISMATCH")
        candidates.append(row)
    print("CANDIDATES="+str(len(candidates)))
    if not args.apply and not args.probe:
        print("DRY_RUN=PASS")
        return 0
    if not candidates:
        print("APPLY=NOT_NEEDED")
        return 0
    process=subprocess.run(
        ["docker","exec","-i","deploy-gaybbs-1","node",
         "--import","/app/preload/telegram-ipv4-preload.mjs",
         "--input-type=module","-e",NODE]+(["probe"] if args.probe else []),
        input=json.dumps(candidates,ensure_ascii=False),text=True,
        capture_output=True,check=False,timeout=500)
    if process.returncode:
        raise RuntimeError("TELEGRAM_WORKER_FAILED")
    outcomes=json.loads(process.stdout)
    if len(outcomes)!=len(candidates):
        raise RuntimeError("TELEGRAM_OUTCOME_COUNT_MISMATCH")
    counts={"updated":0,"ready":0,"telegram_rejected":0,"username_missing":0,
            "button_shape_invalid":0,"skipped":0,"db_mismatch":0}
    for row,result in zip(candidates,outcomes):
        if result.get("delivery_id")!=row["delivery_id"]:
            raise RuntimeError("REPAIR_RECEIPT_ID_MISMATCH")
        status=result.get("status")
        if status!="updated":
            counts[status if status in counts else "skipped"]+=1
            continue
        buttons=result.get("buttons")
        if not updated_keyboard(row["inline_buttons"],buttons):
            counts["db_mismatch"]+=1
            continue
        old_sql=as_sql_json(row["inline_buttons"])
        new_sql=as_sql_json(buttons)
        update=f"""UPDATE posting_deliveries SET inline_buttons={new_sql},
 updated_at=NOW()
 WHERE delivery_id={row['delivery_id']} AND status='sent'
   AND inline_buttons={old_sql}
 RETURNING delivery_id"""
        if psql(update).strip()==str(row["delivery_id"]):
            counts["updated"]+=1
        else:
            counts["db_mismatch"]+=1
    for key,value in counts.items():print(key.upper()+"="+str(value))
    if sum(counts.values())!=len(candidates):
        raise RuntimeError("REPAIR_COUNT_INVALID")
    if args.probe:
        return 0 if counts["ready"]==len(candidates) else 4
    if sum(counts[k] for k in counts if k!="updated"):
        return 4
    return 0

if __name__=="__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print("REPAIR_FAILED="+str(exc).split(":")[0],file=sys.stderr)
        sys.exit(2)
