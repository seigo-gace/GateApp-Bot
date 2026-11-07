#!/usr/bin/env python3
"""Add one ONLINE hub intro card per community-link topic (3 hosts, idempotent)."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import subprocess
import sys
import urllib.request
from pathlib import Path

# Reuse publish_community_posts helpers pattern
ROOT = Path(__file__).resolve().parents[1]
TOPICS = Path(__file__).resolve().parent / "community-link-topics.json"
GATE_LEDGER = Path(__file__).resolve().parent / "online-hub-gate-route.json"
INTRO = Path(__file__).resolve().parent / "community-intro-texts.json"
IMG = Path(__file__).resolve().parent / "online-room-assets" / "00_ONLINE案内_1080.jpg"
IMG_EXPECT = (543343, "01c2917d4d46397641b4a64b7263ea3c264dfb54c6278074abbefb9ea44c3f6b")
PROMOTED = "online_hub"


def psql(sql: str) -> str:
    return subprocess.check_output(
        ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-t", "-A", "-c", sql],
        text=True,
    ).strip()


def token() -> str:
    return Path("/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt").read_text().strip()


def stored_mid(host: int, thread: int) -> int | None:
    row = psql(
        f"SELECT message_id FROM community_link_topic_cards "
        f"WHERE host_chat_id={host} AND message_thread_id={thread} "
        f"AND promoted_board_key='{PROMOTED}' AND message_id IS NOT NULL LIMIT 1"
    )
    return int(row) if row else None


def upsert_db(host: int, thread: int, mid: int, gate: str, fp: str, media: str) -> None:
    psql(
        f"INSERT INTO community_link_topic_cards "
        f"(host_chat_id,message_thread_id,promoted_board_key,message_id,media_file_id,"
        f"image_repo_path,gate_url,intro_fingerprint,status,posted_at,updated_at) "
        f"VALUES ({host},{thread},'{PROMOTED}',{mid},'{media}',"
        f"'deploy/online-room-assets/00_ONLINE案内_1080.jpg','{gate}','{fp}',"
        f"'published',NOW(),NOW()) "
        f"ON CONFLICT (host_chat_id,message_thread_id,promoted_board_key) DO UPDATE SET "
        f"message_id=EXCLUDED.message_id,gate_url=EXCLUDED.gate_url,intro_fingerprint=EXCLUDED.intro_fingerprint,"
        f"status='published',updated_at=NOW()"
    )


def send_photo(tk: str, host: int, thread: int, caption: str, gate: str, data: bytes) -> dict:
    boundary = "----GACECL"
    markup = json.dumps({"inline_keyboard": [[{"text": "🔗参加はこちら", "url": gate}]]})
    fields = {"chat_id": str(host), "message_thread_id": str(thread), "caption": caption, "reply_markup": markup}
    body = bytearray()
    for k, v in fields.items():
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    body.extend(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"00_ONLINE案内_1080.jpg\"\r\n"
        f"Content-Type: image/jpeg\r\n\r\n".encode()
    )
    body.extend(data)
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{tk}/sendPhoto",
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=120).read())


def main() -> int:
    if not GATE_LEDGER.is_file():
        sys.exit("RUN issue_online_hub_gate_route.py --enable FIRST")
    gate_cfg = json.loads(GATE_LEDGER.read_text())
    if not gate_cfg.get("enabled"):
        sys.exit("ONLINE_HUB_GATE_NOT_ENABLED")
    gate = gate_cfg["start_url"]
    intro = json.loads(INTRO.read_text(encoding="utf-8"))["entries"]["online_hub"].strip()
    fp = hashlib.sha256((intro + "\n" + gate).encode()).hexdigest()[:32]
    data = IMG.read_bytes()
    if len(data) != IMG_EXPECT[0] or hashlib.sha256(data).hexdigest() != IMG_EXPECT[1]:
        sys.exit("ONLINE_INTRO_ASSET_MISMATCH")
    hosts = json.loads(TOPICS.read_text(encoding="utf-8"))["hosts"]
    tk = token()
    results = []
    for host in hosts:
        cid, tid = int(host["chat_id"]), int(host["message_thread_id"])
        existing = stored_mid(cid, tid)
        if not existing:
            results.append({
                "host":host["board_key"],"status":"fail",
                "reason":"EXISTING_ONLINE_CARD_MESSAGE_ID_NOT_FOUND_EDIT_ONLY",
            })
            continue
        def tg_json(method: str, payload: dict) -> dict:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{tk}/{method}",
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            return json.loads(urllib.request.urlopen(req, timeout=30).read())

        cap = tg_json("editMessageCaption", {"chat_id": cid, "message_id": existing, "caption": intro})
        markup = tg_json(
            "editMessageReplyMarkup",
            {
                "chat_id": cid,
                "message_id": existing,
                "reply_markup": {"inline_keyboard": [[{"text": "🔗参加はこちら", "url": gate}]]},
            },
        )
        if not cap.get("ok") or not markup.get("ok"):
            results.append(
                {
                    "host": host["board_key"],
                    "status": "fail",
                    "reason": "EXISTING_EDIT_NOT_CONFIRMED",
                    "cap": cap.get("description"),
                    "markup": markup.get("description"),
                }
            )
            continue
        # Do not overwrite an existing Telegram photo media_file_id on edit.
        psql(
            f"UPDATE community_link_topic_cards SET gate_url='{gate}', "
            f"intro_fingerprint='{fp}',updated_at=NOW() "
            f"WHERE host_chat_id={cid} AND message_thread_id={tid} "
            f"AND promoted_board_key='{PROMOTED}' AND message_id={existing}"
        )
        results.append({"host":host["board_key"],"status":"updated",
                        "message_id":existing,"gate_url":gate})

    out = Path(__file__).with_name("online-community-link-publish-result.json")
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False))
    return 1 if any(r.get("status") == "fail" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
