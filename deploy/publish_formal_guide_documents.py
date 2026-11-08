#!/usr/bin/env python3
"""Post adopted formal guide bodies in each L0 thread; register Telegram message_id."""
from __future__ import annotations

import json
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

ADMIN = 7880448530
ROOT = Path(__file__).resolve().parent
DOC_BASE = "https://tgtumbler-docs.pages.dev"

TOPICS = [
    (-1003847210571, 43, "area_bbs"),
    (-1002373696859, 1723, "video_chat"),
    (-1003770334893, 783, "gay_board"),
]

TITLES = {
    "terms": ("規約", f"{DOC_BASE}/terms.html"),
    "rules": ("ルール", f"{DOC_BASE}/group-rules.html"),
    "safety": ("ガイドライン", f"{DOC_BASE}/guidelines.html"),
    "howto": ("使い方", f"{DOC_BASE}/howto.html"),
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
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def psql(sql: str) -> None:
    subprocess.run(
        ["docker", "exec", "-i", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-v", "ON_ERROR_STOP=1"],
        input=sql.encode(),
        check=True,
    )


def main() -> int:
    receipt: list[dict] = []
    for chat_id, thread_id, _board in TOPICS:
        for dtype, (title, url) in TITLES.items():
            existing = subprocess.check_output(
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
                    f"SELECT message_id FROM general_guide_documents WHERE chat_id={chat_id} AND document_type='{dtype}';",
                ],
                text=True,
            ).strip()
            if existing:
                continue
            text = f"📌 {title}\n\n採用済み正式文書（TGtumbler共通）\n全文: {url}"
            sent = api(
                "sendMessage",
                {
                    "chat_id": chat_id,
                    "message_thread_id": thread_id,
                    "text": text,
                    "disable_notification": "true",
                },
            )
            if not sent.get("ok"):
                print("DOC_SEND_FAILED", chat_id, dtype, sent)
                return 2
            mid = sent["result"]["message_id"]
            psql(
                f"""
                INSERT INTO general_guide_documents
                  (chat_id,document_type,message_id,version,approved_by,approved_at,synced_at,status)
                VALUES ({chat_id},'{dtype}',{mid},'formal-adopted-20261109',{ADMIN},NOW(),NOW(),'published')
                ON CONFLICT (chat_id,document_type) DO UPDATE SET
                  message_id=EXCLUDED.message_id,status='published',
                  approved_by=EXCLUDED.approved_by,approved_at=NOW(),synced_at=NOW();
                """
            )
            receipt.append({"chat_id": chat_id, "document_type": dtype, "message_id": mid})
    out = ROOT / "formal-guide-document-publish-result.json"
    out.write_text(json.dumps({"published": receipt}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"published_count": len(receipt), "receipt": str(out)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
