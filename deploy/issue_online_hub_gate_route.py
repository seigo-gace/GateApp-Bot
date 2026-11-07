#!/usr/bin/env python3
"""Issue or enable the ONLINE hub gate route (Area BBS topic /1000). Does not touch ROOM B/C/D."""
from __future__ import annotations

import hashlib
import json
import secrets
import subprocess
import sys
import urllib.request
from pathlib import Path

AREA_CHAT = -1003847210571
TOPIC_URL = "https://t.me/c/3847210571/1000"
CARD_KEY = "online_hub"
BOT = "GayBBS_bot"


def psql(sql: str) -> str:
    return subprocess.check_output(
        ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-t", "-A", "-c", sql],
        text=True,
    ).strip()


def main() -> None:
    enable = "--enable" in sys.argv
    psql(
        "ALTER TABLE online_gate_routes DROP CONSTRAINT IF EXISTS online_gate_routes_card_key_check;"
    )
    psql(
        "ALTER TABLE online_gate_routes ADD CONSTRAINT online_gate_routes_card_key_check "
        "CHECK (card_key IN ('area_bbs','video_chat','gay_board','online_hub'));"
    )
    psql(
        "ALTER TABLE community_link_topic_cards DROP CONSTRAINT IF EXISTS community_link_topic_cards_promoted_board_key_check;"
    )
    psql(
        "ALTER TABLE community_link_topic_cards ADD CONSTRAINT community_link_topic_cards_promoted_board_key_check "
        "CHECK (promoted_board_key IN ('areas_bbs','video_chat','gay_board','online_hub'));"
    )
    token = Path("/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt").read_text().strip()
    me = json.loads(
        urllib.request.urlopen(
            urllib.request.Request(f"https://api.telegram.org/bot{token}/getMe", data=b"{}", method="POST"),
            timeout=30,
        ).read()
    )["result"]
    row = psql(f"SELECT start_url,enabled,chat_id,topic_url FROM online_gate_routes WHERE card_key='{CARD_KEY}'")
    if not row:
        suffix = secrets.token_urlsafe(18)[:24]
        start = f"online_{suffix}"
        digest = hashlib.sha256(start.encode()).hexdigest()
        url = f"https://t.me/{BOT}?start={start}"
        psql(
            "INSERT INTO online_gate_routes "
            f"(card_key,token_hash,start_url,chat_id,topic_url,verified_by,enabled) "
            f"VALUES ('{CARD_KEY}','{digest}','{url}',{AREA_CHAT},'{TOPIC_URL}',{me['id']},FALSE)"
        )
        row = psql(f"SELECT start_url,enabled,chat_id,topic_url FROM online_gate_routes WHERE card_key='{CARD_KEY}'")
    url, en, cid, topic = row.split("|")
    if int(cid) != AREA_CHAT or topic != TOPIC_URL:
        sys.exit("ONLINE_HUB_ROUTE_MISMATCH")
    if enable:
        psql(f"UPDATE online_gate_routes SET enabled=TRUE WHERE card_key='{CARD_KEY}'")
        en = "t"
    out = {"card_key": CARD_KEY, "start_url": url, "enabled": en == "t", "chat_id": AREA_CHAT, "topic_url": TOPIC_URL}
    Path(__file__).with_name("online-hub-gate-route.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
