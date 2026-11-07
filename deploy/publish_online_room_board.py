#!/usr/bin/env python3
"""Publish 4 ONLINE ROOM cards after asset + gate verification."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

AREA_CHAT, ONLINE_THREAD = -1003847210571, 1000
ASSET_DIR = Path(__file__).resolve().parent / "online-room-assets"
FILES = {
    "intro": ("00_ONLINE案内_1080.jpg", "image/jpeg", 543343, "01c2917d4d46397641b4a64b7263ea3c264dfb54c6278074abbefb9ea44c3f6b"),
    "area_bbs": ("01_エリアsBBS_1080.png", "image/png", 1109867, "8220e50b1a295c789b056ef48a49ac6a36826e0ca624d5fa5ad7513ad54e35b5"),
    "video_chat": ("02_ビデオChat_1080.jpg", "image/jpeg", 387687, "47f7a8345e3e8e082276a447f75390b0fd47f622c7be857832d6e05d1052c55e"),
    "gay_board": ("03_ゲイ掲示板_1080.jpg", "image/jpeg", 475218, "bffea7ac0137ddf2abf8166a62472f02907f657c9700f1cabbbc3c2a502364f9"),
}
CAPTIONS = {
    "intro": "🎬 ビデオChat ROOMのご案内\n\nビデオChat ROOMは、今すぐの開催も日時を決めた予告もできます。プロフィールと連動した開催案内や参加者募集を投稿できます。\n\n下の3つの掲示板から希望する場所へ進み、投稿メニューで募集内容と開催先を確認してから公開してください。参加したい方も各掲示板から案内を探せます。",
    "area_bbs": "エリア’s BBS｜ビデオChat ROOM\n\nエリア’s BBSでROOMの開催案内・予告・参加者募集を探せます。投稿したい場合は、専用掲示板の投稿メニューから内容と投稿先を確認してください。",
    "video_chat": "ビデオ👀Chat掲示板｜ビデオChat ROOM\n\nビデオChatの開催案内や参加者募集を確認する専用掲示板です。ROOMの開催や募集の投稿は、移動先の投稿メニューから進めてください。",
    "gay_board": "🆕ゲイのための掲示板♂｜ビデオChat ROOM\n\n見せ合いなど目的に合う相手を探す掲示板へ案内します。ROOMを使った交流・募集の投稿可否は、移動先の投稿メニューで確認してください。",
}
ORDER = ["intro", "area_bbs", "video_chat", "gay_board"]


def psql(sql: str) -> str:
    return subprocess.check_output(
        ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-t", "-A", "-c", sql], text=True
    ).strip()


def token() -> str:
    return Path("/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt").read_text().strip()


def send_photo(tk: str, fname: str, mime: str, data: bytes, caption: str, btn: tuple[str, str]) -> int:
    boundary = "----GACEONLINE"
    markup = json.dumps({"inline_keyboard": [[{"text": btn[0], "url": btn[1]}]]})
    fields = {
        "chat_id": str(AREA_CHAT),
        "message_thread_id": str(ONLINE_THREAD),
        "caption": caption,
        "reply_markup": markup,
    }
    body = bytearray()
    for k, v in fields.items():
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    body.extend(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"{fname}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
    )
    body.extend(data)
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{tk}/sendPhoto",
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    out = json.loads(urllib.request.urlopen(req, timeout=120).read())
    if not out.get("ok"):
        raise SystemExit(out.get("description"))
    return int(out["result"]["message_id"])


def main() -> None:
    gates = {}
    for key in ("area_bbs", "video_chat", "gay_board"):
        row = psql(f"SELECT start_url,enabled FROM online_gate_routes WHERE card_key='{key}'")
        if not row:
            sys.exit(f"GATE_ROUTE_MISSING:{key}")
        url, en = row.split("|")
        if en != "t":
            sys.exit(f"GATE_ROUTE_NOT_ENABLED:{key}")
        gates[key] = url
    set_row = psql(f"SELECT set_id,state FROM online_room_board_sets WHERE chat_id={AREA_CHAT} AND message_thread_id={ONLINE_THREAD}")
    if not set_row:
        psql(f"INSERT INTO online_room_board_sets (chat_id,message_thread_id,state,verified_by) VALUES ({AREA_CHAT},{ONLINE_THREAD},'verified',8872855519)")
        set_id = psql(f"SELECT set_id FROM online_room_board_sets WHERE chat_id={AREA_CHAT} AND message_thread_id={ONLINE_THREAD}")
    else:
        set_id, state = set_row.split("|")
        if state == "published" and psql(f"SELECT count(*) FROM online_room_board_cards WHERE set_id={set_id}") == "4":
            print(json.dumps({"status": "skipped", "set_id": int(set_id)}))
            return
    tk = token()
    receipts = {}
    for key in ORDER:
        name, mime, size, digest = FILES[key]
        path = ASSET_DIR / name
        if not path.is_file():
            sys.exit(f"ASSET_MISSING:{name}")
        data = path.read_bytes()
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            sys.exit(f"ASSET_CHECKSUM_MISMATCH:{name}")
        btn = ("↩ 総合案内へ戻る", "https://t.me/c/3847210571/43") if key == "intro" else ("🎬 ROOM掲示板へ", gates[key])
        mid = send_photo(tk, name, mime, data, CAPTIONS[key], btn)
        psql(f"INSERT INTO online_room_board_cards (set_id,card_key,message_id) VALUES ({set_id},'{key}',{mid}) ON CONFLICT DO NOTHING")
        receipts[key] = mid
    psql(f"UPDATE online_room_board_sets SET state='published',updated_at=NOW() WHERE set_id={set_id}")
    result = {"chat_id": AREA_CHAT, "message_thread_id": ONLINE_THREAD, "cards": receipts}
    Path(__file__).with_name("online-room-publish-result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
