#!/usr/bin/env python3
"""Verify missing ordinary forum menu entrances before sending any Telegram post.

Only verified non-announcement candidates; existing messages, published pins,
unknown send outcomes, unverified DB routes and excluded topics stay untouched.
No Telegram session access: only the already-authorized resident IPC client.
"""
from __future__ import annotations
import argparse
import json
import re
import subprocess
import sys

FORUMS = {
    "area": (-1003847210571, [(105, "国際交流")]),
    "video": (-1002373696859, [(4672, "サブスク")]),
    "category": (-1003770334893, []),
}
EXCLUDE = re.compile("お知らせ|総合案内|雑談|コミュニティ.?リンク|エリアブロック|オンライン")
POSTGRES = re.compile(r"postgres", re.IGNORECASE)

def run(args, timeout=110):
    p = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    return p.returncode, p.stdout

def live_rows(chat, group, topic):
    for page in range(10):
        code, output = run([sys.executable, "scripts/userbot_topic_audit_client.py",
                            "--chat-id", str(chat), "--page", str(page)])
        if code != 0:
            raise RuntimeError("RESIDENT_AUDIT_NOT_AVAILABLE")
        records = [json.loads(line.split("=", 1)[1])
                   for line in output.splitlines()
                   if line.startswith("USERBOT_TOPIC_AUDIT=")]
        if len(records) != 1 or records[0].get("chat") != group:
            raise RuntimeError("RESIDENT_AUDIT_RESULT_INVALID")
        selected = next((row for row in records[0]["rows"] if row["topic_id"] == topic), None)
        if selected:
            return selected
        if not records[0].get("has_more"):
            break
    raise RuntimeError("CANDIDATE_TOPIC_NOT_FOUND")

def pg():
    code, out = run(["docker", "ps", "--format", "{{.Names}}"], 30)
    names = [x for x in out.splitlines() if POSTGRES.search(x)]
    if code or len(names) != 1:
        raise RuntimeError("POSTGRES_RUNTIME_NOT_UNIQUE")
    return names[0]

def query(name, statement):
    # Never put an untrusted URL or opaque token into the shell or logs.
    p = subprocess.run(["docker", "exec", "-i", name, "sh", "-c",
        'exec psql -X -q -At -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d gaybbs -f -'],
        input=statement, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, timeout=40)
    if p.returncode:
        raise RuntimeError("DATABASE_READBACK_FAILED")
    return [line.strip() for line in p.stdout.splitlines() if line.strip()]

def classify(row, expect):
    title = str(row.get("title", ""))
    if expect not in title or EXCLUDE.search(title):
        return "OUT_OF_SCOPE_OR_CHANGED_TITLE"
    if row.get("post_button") == "PRESENT":
        return "EXISTING_BUTTON_PROTECTED"
    if row.get("post_button") != "ABSENT":
        return "HISTORY_INCONCLUSIVE"
    if row.get("pin_state") != "ABSENT_FROM_PINS":
        return "PIN_STATE_INCONCLUSIVE"
    if row.get("history_inspected", 0) < 1:
        return "HISTORY_NOT_VERIFIED"
    return "MISSING_CONFIRMED"

def candidate_status(name, chat, thread, row):
    pins = query(name, f"""SELECT state,COALESCE(message_id,0),pinned
      FROM topic_dm_entry_pins WHERE chat_id={chat} AND message_thread_id={thread};""")
    if pins and pins != ["verified|0|f"]:
        return "PIN_LEDGER_PROTECTED"
    routes = query(name, f"""SELECT COUNT(*) FROM posting_topics
      WHERE chat_id={chat} AND message_thread_id={thread}
      AND enabled=TRUE AND verified_at IS NOT NULL;""")
    if routes != ["1"]:
        return "DESTINATION_ROUTE_NOT_VERIFIED"
    return "READY_FOR_SINGLE_ENTRY"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("dry-run",), required=True)
    parser.parse_args()
    name = pg()
    counters = {}
    for group, (chat, candidates) in FORUMS.items():
        for thread, title in candidates:
            row = live_rows(chat, group, thread)
            status = classify(row, title)
            if status == "MISSING_CONFIRMED":
                status = candidate_status(name, chat, thread, row)
            counters[str(chat) + ":" + str(thread)] = status
            print(f"NORMAL_ENTRY_CANDIDATE={group}:{thread}:{status}")
    print("NORMAL_ENTRY_DRY_RUN=PASS")
    return counters

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("NORMAL_ENTRY_DRY_RUN=FAIL")
        print("NORMAL_ENTRY_ERROR=" + type(exc).__name__ + "_" +
              re.sub("[^A-Z0-9_]", "_", str(exc).upper())[:100])
        raise SystemExit(1)
