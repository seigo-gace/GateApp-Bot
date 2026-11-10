#!/usr/bin/env python3
"""One document at a time: forward inspect → classify → UPSERT → checkpoint."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LEDGER = json.loads((ROOT / "menu-topic-ledger-v1.json").read_text(encoding="utf-8"))
ADMIN = int(LEDGER["admin_telegram_id"])
CHECKPOINT = ROOT / "guide-document-checkpoint.json"

TOPICS = [
    ("area_bbs", -1003847210571, 43),
    ("video_chat", -1002373696859, 1723),
    ("gay_board", -1003770334893, 783),
]

CLASSIFIERS: list[tuple[str, re.Pattern[str]]] = [
    ("terms", re.compile(r"利用規約|②規約|terms\.html", re.I)),
    ("rules", re.compile(r"グループルール|④グループ|group-rules", re.I)),
    ("safety", re.compile(r"安全ガイド|①共通|guidelines", re.I)),
    ("privacy", re.compile(r"プライバシー|③[Pp]rivacy|privacy", re.I)),
    ("howto", re.compile(r"使い方|操作方法|⑤使い方", re.I)),
]

REJECT_PATTERNS = re.compile(r"不祥事|運営再建|横領|詐欺", re.I)

# Candidate message_id windows per board (thread-centric; no 7.5min full scan)
CANDIDATES: dict[int, list[int]] = {
    -1003847210571: list(range(40, 120)),
    -1002373696859: list(range(1718, 1745)),
    -1003770334893: list(range(778, 820)),
}


def token() -> str:
    return (ROOT / "secrets" / "bot_token.txt").read_text(encoding="utf-8").strip()


def api(method: str, fields: dict) -> dict:
    data = urllib.parse.urlencode({k: str(v) for k, v in fields.items()}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token()}/{method}",
        data=data,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode())
        except json.JSONDecodeError:
            return {"ok": False, "description": exc.read().decode()[:200]}


def load_checkpoint() -> dict:
    if CHECKPOINT.is_file():
        return json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    return {"bound": [], "rejected": [], "pending": []}


def save_checkpoint(data: dict) -> None:
    CHECKPOINT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def psql(sql: str) -> None:
    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            "deploy-postgres-1",
            "psql",
            "-U",
            "gace",
            "-d",
            "gaybbs",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input=sql.encode(),
        check=True,
    )


def bound_types(chat_id: int) -> set[str]:
    proc = subprocess.run(
        [
            "docker",
            "exec",
            "deploy-postgres-1",
            "psql",
            "-U",
            "gace",
            "-d",
            "gaybbs",
            "-t",
            "-A",
            "-c",
            f"SELECT document_type FROM general_guide_documents WHERE chat_id={chat_id};",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return {x.strip() for x in proc.stdout.splitlines() if x.strip()}


def inspect(chat_id: int, thread_id: int, message_id: int) -> dict | None:
    fwd = api(
        "forwardMessage",
        {"chat_id": ADMIN, "from_chat_id": chat_id, "message_id": message_id},
    )
    if not fwd.get("ok"):
        return None
    msg = fwd["result"]
    text = msg.get("text") or msg.get("caption") or ""
    dm_mid = msg["message_id"]
    api("deleteMessage", {"chat_id": ADMIN, "message_id": dm_mid})
    msg_thread = msg.get("message_thread_id")
    if msg_thread is not None and int(msg_thread) != int(thread_id):
        return {"skip": "wrong_thread", "message_id": message_id, "thread": msg_thread}
    if REJECT_PATTERNS.search(text):
        return {"skip": "not_legal_doc", "message_id": message_id, "preview": text[:80]}
    dtype = None
    for name, pat in CLASSIFIERS:
        if pat.search(text):
            dtype = name
            break
    if not dtype:
        return {"skip": "unclassified", "message_id": message_id, "preview": text[:80]}
    return {"ok": True, "document_type": dtype, "message_id": message_id, "preview": text[:120]}


def bind(chat_id: int, dtype: str, mid: int) -> None:
    psql(
        f"""
        INSERT INTO general_guide_documents
          (chat_id,document_type,message_id,version,approved_by,approved_at,synced_at,status)
        VALUES ({chat_id},'{dtype}',{mid},'discovered-existing',{ADMIN},NOW(),NOW(),'published')
        ON CONFLICT (chat_id,document_type) DO UPDATE SET
          message_id=EXCLUDED.message_id,status='published',
          approved_by=EXCLUDED.approved_by,approved_at=NOW(),synced_at=NOW();
        """
    )


def main() -> int:
    cp = load_checkpoint()
    thread_by_chat = {cid: tid for _, cid, tid in TOPICS}
    for board_key, chat_id, thread_id in TOPICS:
        have = bound_types(chat_id)
        need = {"terms", "rules", "safety", "privacy", "howto"} - have
        if not need:
            continue
        for mid in CANDIDATES.get(chat_id, []):
            key = f"{chat_id}:{mid}"
            if any(x.get("message_id") == mid and x.get("chat_id") == chat_id for x in cp.get("bound", [])):
                continue
            result = inspect(chat_id, thread_id, mid)
            time.sleep(0.12)
            if not result or not result.get("ok"):
                if result:
                    cp.setdefault("rejected", []).append({**result, "chat_id": chat_id, "board_key": board_key})
                continue
            dtype = result["document_type"]
            if dtype not in need:
                cp.setdefault("rejected", []).append(
                    {**result, "chat_id": chat_id, "board_key": board_key, "skip": "type_already_or_extra"}
                )
                save_checkpoint(cp)
                continue
            bind(chat_id, dtype, mid)
            entry = {
                "board_key": board_key,
                "chat_id": chat_id,
                "thread_id": thread_id,
                **result,
            }
            cp.setdefault("bound", []).append(entry)
            cp.setdefault("pending", []).append({**entry, "content_review": "NOTION_FORMAL_TEXT_NOT_VERIFIED_YET"})
            save_checkpoint(cp)
            print(json.dumps({"bound": entry}, ensure_ascii=False))
            need.discard(dtype)
            if not need:
                break
    save_checkpoint(cp)
    out = ROOT / "guide-document-discovery-result.json"
    out.write_text(json.dumps(cp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"receipt": str(out), "bound_total": len(cp.get("bound", []))}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
