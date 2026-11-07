#!/usr/bin/env python3
"""Edit already-published ONLINE ROOM cards in place, never send a new post."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import urllib.error
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


def edit_card(tk: str, message_id: int, caption: str, btn: tuple[str, str]) -> None:
    """Edit an existing Bot photo message; never create a replacement post."""
    payload = {
        "chat_id": AREA_CHAT,
        "message_id": message_id,
        "caption": caption,
        "reply_markup": {
            "inline_keyboard": [[{"text": btn[0], "url": btn[1]}]]
        },
    }
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{tk}/editMessageCaption",
        data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.load(resp)
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        if exc.code == 400 and "message is not modified" in details.lower():
            return
        sys.exit(f"ONLINE_EXISTING_CARD_EDIT_FAILED:{message_id}:HTTP{exc.code}")
    if not result.get("ok"):
        sys.exit(f"ONLINE_EXISTING_CARD_EDIT_NOT_CONFIRMED:{message_id}")


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
        sys.exit("ONLINE_EXISTING_SET_NOT_FOUND_EDIT_ONLY")
    set_id, state = set_row.split("|")
    if state != "published":
        sys.exit("ONLINE_SET_NOT_PUBLISHED_EDIT_ONLY")
    existing = {}
    for key in ORDER:
        found = psql(
            f"SELECT message_id FROM online_room_board_cards "
            f"WHERE set_id={set_id} AND card_key='{key}'"
        )
        if not found or not found.isdigit() or int(found) <= 0:
            sys.exit(f"ONLINE_EXISTING_MESSAGE_ID_MISSING:{key}")
        existing[key] = int(found)
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
        mid = existing[key]
        edit_card(tk, mid, CAPTIONS[key], btn)
        receipts[key] = mid
    psql(f"UPDATE online_room_board_sets SET state='published',updated_at=NOW() WHERE set_id={set_id}")
    result = {"chat_id": AREA_CHAT, "message_thread_id": ONLINE_THREAD, "cards": receipts}
    Path(__file__).with_name("online-room-publish-result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
