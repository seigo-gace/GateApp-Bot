#!/usr/bin/env python3
"""Publish or update TGtumbler community-link image posts (idempotent)."""
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
BOARD_KEY_TOPIC = {"areas_bbs": "area_bbs", "video_chat": "video_chat", "gay_board": "gay_board"}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def psql(sql: str) -> list[str]:
    env = os.environ.copy()
    db_url = env.get(
        "DATABASE_URL",
        "postgresql://gace:devlocalpass123@127.0.0.1:55432/gaybbs",
    )
    # docker exec fallback when local psql missing
    if subprocess.run(["which", "psql"], capture_output=True).returncode != 0:
        cmd = [
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
            sql,
        ]
    else:
        cmd = ["psql", db_url, "-t", "-A", "-c", sql]
    out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
    return [line for line in out.splitlines() if line.strip()]


def telegram(token: str, method: str, **params):
    boundary = "----tgboundary7"
    body = bytearray()
    file_fields: list[tuple[str, Path, str]] = []
    for key, val in params.items():
        if isinstance(val, Path):
            file_fields.append((key, val, mimetypes.guess_type(val.name)[0] or "application/octet-stream"))
            continue
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        body.extend(str(val).encode())
        body.extend(b"\r\n")
    for key, path, mime in file_fields:
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


def resolve_thread(chat_id: int, board_key: str) -> int | None:
    bk = BOARD_KEY_TOPIC.get(board_key, board_key)
    rows = psql(
        f"SELECT message_thread_id FROM posting_topics "
        f"WHERE chat_id={chat_id} AND board_key='{bk}' AND purpose='link' AND enabled=TRUE "
        f"ORDER BY verified_at DESC NULLS LAST LIMIT 1;"
    )
    if rows:
        return int(rows[0])
    rows = psql(
        f"SELECT message_thread_id FROM community_link_publications "
        f"WHERE board_key='{board_key}' AND message_thread_id IS NOT NULL LIMIT 1;"
    )
    if rows:
        return int(rows[0])
    rows = psql(
        f"SELECT message_thread_id FROM general_guide_topics "
        f"WHERE chat_id={chat_id} AND enabled=TRUE LIMIT 1;"
    )
    if rows:
        return int(rows[0])
    return None


def caption(intro: str, gate_url: str) -> str:
    join = f'<a href="{gate_url}">参加はこちら</a>'
    return f"{intro}\n\n{join}"


def fingerprint(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:32]


def upsert_publication(
    board_key: str,
    chat_id: int,
    thread_id: int,
    message_id: int,
    media_file_id: str,
    repo_path: str,
    gate_url: str,
    intro_fp: str,
):
    thread_sql = "NULL" if thread_id is None else str(int(thread_id))
    psql(
        f"INSERT INTO community_link_publications "
        f"(board_key,chat_id,message_thread_id,message_id,media_file_id,"
        f"image_repo_path,gate_url,intro_fingerprint,status,posted_at,updated_at) "
        f"VALUES ('{board_key}',{chat_id},{thread_sql},{message_id},"
        f"'{media_file_id}','{repo_path}','{gate_url}','{intro_fp}','published',NOW(),NOW()) "
        f"ON CONFLICT (board_key) DO UPDATE SET "
        f"chat_id=EXCLUDED.chat_id,message_thread_id=EXCLUDED.message_thread_id,"
        f"message_id=EXCLUDED.message_id,media_file_id=EXCLUDED.media_file_id,"
        f"image_repo_path=EXCLUDED.image_repo_path,gate_url=EXCLUDED.gate_url,"
        f"intro_fingerprint=EXCLUDED.intro_fingerprint,status='published',"
        f"updated_at=NOW(),posted_at=COALESCE(community_link_publications.posted_at,NOW());"
    )


def main() -> int:
    token = os.environ.get("BOT_TOKEN")
    if not token:
        token_file = os.environ.get(
            "BOT_TOKEN_FILE",
            "/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt",
        )
        token = Path(token_file).read_text().strip()
    assets = load_json(ASSETS)
    intros = load_json(INTROS)["entries"]
    results = []
    for entry in assets["entries"]:
        key = entry["key"]
        chat_id = int(entry["chat_id"])
        gate_url = entry["entry_url"]
        intro = intros.get(key, "").strip()
        if not intro:
            print(f"SKIP {key}: intro missing", file=sys.stderr)
            results.append({"key": key, "status": "skip", "reason": "intro_missing"})
            continue
        img_rel = entry["image"]["primary"]["repo_path"]
        img_path = ROOT / img_rel
        if not img_path.is_file():
            print(f"SKIP {key}: image missing {img_path}", file=sys.stderr)
            results.append({"key": key, "status": "skip", "reason": "image_missing"})
            continue
        thread_id = resolve_thread(chat_id, key)
        if thread_id is None:
            print(f"FAIL {key}: no posting thread", file=sys.stderr)
            results.append({"key": key, "status": "fail", "reason": "no_thread"})
            continue
        cap = caption(intro, gate_url)
        intro_fp = fingerprint(intro + gate_url)
        pub = entry.get("publication") or {}
        message_id = pub.get("message_id")
        rows = psql(
            f"SELECT message_id,media_file_id FROM community_link_publications "
            f"WHERE board_key='{key}' LIMIT 1;"
        )
        db_msg = None
        if rows:
            parts = rows[0].split("|")
            if len(parts) >= 1 and parts[0]:
                db_msg = int(parts[0])
        target_msg = db_msg or message_id
        if target_msg:
            resp = telegram_json(
                token,
                "editMessageCaption",
                {
                    "chat_id": chat_id,
                    "message_id": int(target_msg),
                    "caption": cap,
                    "parse_mode": "HTML",
                },
            )
            if not resp.get("ok"):
                target_msg = None
        if not target_msg:
            photo_args = dict(
                chat_id=chat_id,
                photo=img_path,
                caption=cap,
                parse_mode="HTML",
            )
            if thread_id is not None:
                photo_args["message_thread_id"] = thread_id
            resp = telegram(token, "sendPhoto", **photo_args)
            if not resp.get("ok") and "message thread not found" in str(resp.get("description", "")):
                photo_args.pop("message_thread_id", None)
                thread_id = None
                resp = telegram(token, "sendPhoto", **photo_args)
            if not resp.get("ok"):
                print(json.dumps(resp, ensure_ascii=False), file=sys.stderr)
                results.append({"key": key, "status": "fail", "reason": resp.get("description")})
                continue
            msg = resp["result"]
            target_msg = msg["message_id"]
            media_file_id = msg.get("photo", [{}])[-1].get("file_id", "")
        else:
            media_file_id = ""
            if rows and len(rows[0].split("|")) > 1:
                media_file_id = rows[0].split("|")[1]
        slug = str(chat_id).replace("-100", "")
        url = f"https://t.me/c/{slug}/{target_msg}"
        upsert_publication(
            key, chat_id, thread_id, int(target_msg), media_file_id or "unknown",
            img_rel, gate_url, intro_fp,
        )
        entry.setdefault("publication", {})["status"] = "published"
        entry["publication"]["chat_id"] = str(chat_id)
        entry["publication"]["message_id"] = int(target_msg)
        if thread_id is not None:
            entry["publication"]["message_thread_id"] = thread_id
        entry["publication"]["updated_at"] = datetime.now(timezone.utc).isoformat()
        results.append(
            {
                "key": key,
                "status": "published",
                "chat_id": chat_id,
                "message_thread_id": thread_id,
                "message_id": int(target_msg),
                "url": url,
            }
        )
        print(f"OK {key} thread={thread_id} msg={target_msg} {url}")
    assets_path = ASSETS
    assets_path.write_text(json.dumps(assets, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = ROOT / "deploy" / "community-post-results.json"
    report.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    failed = [r for r in results if r.get("status") == "fail"]
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
