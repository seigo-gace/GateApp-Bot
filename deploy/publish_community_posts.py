#!/usr/bin/env python3
"""Publish 3x3 TGtumbler community-link intro cards (idempotent)."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "artifacts/bot/deploy/community-post-assets.json"
INTROS = Path(__file__).resolve().parent / "community-intro-texts.json"
TOPICS = Path(__file__).resolve().parent / "community-link-topics.json"
BOARD_TOPIC_ROW = {
    "areas_bbs": "area_bbs",
    "video_chat": "video_chat",
    "gay_board": "gay_board",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def psql(sql: str) -> list[str]:
    if subprocess.run(["which", "psql"], capture_output=True).returncode != 0:
        cmd = ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-t", "-A", "-c", sql]
    else:
        cmd = [
            "psql",
            os.environ.get("DATABASE_URL", "postgresql://gace:devlocalpass123@127.0.0.1:55432/gaybbs"),
            "-t",
            "-A",
            "-c",
            sql,
        ]
    out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
    return [line for line in out.splitlines() if line.strip()]


def esc(s: str) -> str:
    return s.replace("'", "''")


def telegram_multipart(token: str, method: str, fields: dict, files: dict | None = None):
    boundary = "----tgboundary9"
    body = bytearray()
    for key, val in fields.items():
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        body.extend(str(val).encode())
        body.extend(b"\r\n")
    for key, path in (files or {}).items():
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            f'Content-Disposition: form-data; name="{key}"; filename="{path.name}"\r\n'.encode()
        )
        body.extend(f"Content-Type: {mime}\r\n\r\n".encode())
        body.extend(path.read_bytes())
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())
    url = f"https://api.telegram.org/bot{token}/{method}"
    req = urllib.request.Request(
        url,
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode() or "{}")


def telegram_json(token: str, method: str, payload: dict):
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def fingerprint(intro: str, gate_url: str) -> str:
    return hashlib.sha256((intro + "\n" + gate_url).encode()).hexdigest()[:32]


def join_markup(gate_url: str) -> str:
    return json.dumps(
        {"inline_keyboard": [[{"text": "🔗参加はこちら", "url": gate_url}]]},
        ensure_ascii=False,
    )


def stored_message(host_chat_id: int, thread_id: int, promoted: str) -> int | None:
    rows = psql(
        f"SELECT message_id FROM community_link_topic_cards "
        f"WHERE host_chat_id={host_chat_id} AND message_thread_id={thread_id} "
        f"AND promoted_board_key='{esc(promoted)}' AND message_id IS NOT NULL LIMIT 1;"
    )
    if not rows:
        return None
    try:
        return int(rows[0])
    except ValueError:
        return None


def upsert_card(
    host_chat_id: int,
    thread_id: int,
    promoted: str,
    message_id: int,
    media_file_id: str,
    repo_path: str,
    gate_url: str,
    intro_fp: str,
):
    psql(
        f"INSERT INTO community_link_topic_cards "
        f"(host_chat_id,message_thread_id,promoted_board_key,message_id,media_file_id,"
        f"image_repo_path,gate_url,intro_fingerprint,status,posted_at,updated_at) "
        f"VALUES ({host_chat_id},{thread_id},'{esc(promoted)}',{message_id},"
        f"'{esc(media_file_id)}','{esc(repo_path)}','{esc(gate_url)}','{esc(intro_fp)}',"
        f"'published',NOW(),NOW()) "
        f"ON CONFLICT (host_chat_id,message_thread_id,promoted_board_key) DO UPDATE SET "
        f"message_id=EXCLUDED.message_id,media_file_id=EXCLUDED.media_file_id,"
        f"image_repo_path=EXCLUDED.image_repo_path,gate_url=EXCLUDED.gate_url,"
        f"intro_fingerprint=EXCLUDED.intro_fingerprint,status='published',"
        f"updated_at=NOW(),posted_at=COALESCE(community_link_topic_cards.posted_at,NOW());"
    )


def register_posting_topic(board_key: str, chat_id: int, thread_id: int, title: str):
    bk = BOARD_TOPIC_ROW[board_key]
    psql(
        f"INSERT INTO posting_topics "
        f"(board_key,purpose,chat_id,message_thread_id,title,verified_by,verified_at,enabled) "
        f"VALUES ('{bk}','link',{chat_id},{thread_id},'{esc(title)}',8872855519,NOW(),TRUE) "
        f"ON CONFLICT (board_key,purpose,chat_id,message_thread_id) DO UPDATE SET "
        f"title=EXCLUDED.title,verified_at=NOW(),enabled=TRUE;"
    )


def publish_one(
    token: str,
    host_chat_id: int,
    thread_id: int,
    promoted: str,
    intro: str,
    gate_url: str,
    img_path: Path,
    img_rel: str,
) -> dict:
    cap = intro.strip()
    intro_fp = fingerprint(intro, gate_url)
    markup = join_markup(gate_url)
    mid = stored_message(host_chat_id, thread_id, promoted)
    if mid:
        cap_res = telegram_json(
            token,
            "editMessageCaption",
            {"chat_id": host_chat_id, "message_id": mid, "caption": cap},
        )
        markup_res = telegram_json(
            token,
            "editMessageReplyMarkup",
            {"chat_id": host_chat_id, "message_id": mid, "reply_markup": json.loads(markup)},
        )
        if cap_res.get("ok") and markup_res.get("ok"):
            slug = str(host_chat_id).replace("-100", "")
            return {
                "status": "updated",
                "message_id": mid,
                "url": f"https://t.me/c/{slug}/{mid}",
            }
    # Existing approved community cards must be edited in place.
    # Never sendPhoto or create replacement posts on missing/failed edits.
    return {
        "status": "fail",
        "reason": "EXISTING_POST_EDIT_ONLY_RECONCILE_REQUIRED",
        "host_chat_id": host_chat_id,
        "thread_id": thread_id,
        "promoted": promoted,
    }


def ensure_schema():
    psql(
        """
CREATE TABLE IF NOT EXISTS community_link_topic_cards (
  host_chat_id BIGINT NOT NULL,
  message_thread_id BIGINT NOT NULL,
  promoted_board_key TEXT NOT NULL
    CHECK (promoted_board_key IN ('areas_bbs','video_chat','gay_board')),
  message_id BIGINT,
  media_file_id TEXT,
  image_repo_path TEXT NOT NULL,
  gate_url TEXT NOT NULL,
  intro_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_verified'
    CHECK (status IN ('not_verified','published','needs_reconcile')),
  posted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (host_chat_id, message_thread_id, promoted_board_key)
);
"""
    )


def main() -> int:
    token_file = os.environ.get(
        "BOT_TOKEN_FILE",
        "/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt",
    )
    token = os.environ.get("BOT_TOKEN") or Path(token_file).read_text().strip()
    ensure_schema()
    assets = {e["key"]: e for e in load_json(ASSETS)["entries"]}
    intros = load_json(INTROS)["entries"]
    hosts = load_json(TOPICS)["hosts"]
    results = []
    for host in hosts:
        register_posting_topic(
            host["board_key"],
            int(host["chat_id"]),
            int(host["message_thread_id"]),
            host.get("topic_title_verified", "link"),
        )
        for promoted in ("areas_bbs", "video_chat", "gay_board"):
            entry = assets[promoted]
            intro = intros.get(promoted, "").strip()
            gate = entry["entry_url"]
            img_rel = entry["image"]["primary"]["repo_path"]
            img_path = ROOT / img_rel
            if not img_path.is_file():
                results.append(
                    {
                        "host": host["board_key"],
                        "promoted": promoted,
                        "status": "fail",
                        "reason": "image_missing",
                    }
                )
                continue
            out = publish_one(
                token,
                int(host["chat_id"]),
                int(host["message_thread_id"]),
                promoted,
                intro,
                gate,
                img_path,
                img_rel,
            )
            row = {
                "host_chat_id": host["chat_id"],
                "host_board": host["board_key"],
                "message_thread_id": host["message_thread_id"],
                "topic_title": host.get("topic_title_verified"),
                "promoted_board_key": promoted,
                **out,
            }
            results.append(row)
            print(json.dumps(row, ensure_ascii=False))
    report = Path(__file__).resolve().parent / "community-post-results.json"
    report.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    failed = [r for r in results if r.get("status") == "fail"]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
