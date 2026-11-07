#!/usr/bin/env python3
"""Issue and optionally enable ONLINE gate START links for @GayBBS_bot."""
from __future__ import annotations

import hashlib
import json
import secrets
import subprocess
import sys
import urllib.request
from pathlib import Path

ROUTES = {
    "area_bbs": (-1003847210571, "https://t.me/c/3847210571/116"),
    "video_chat": (-1002373696859, "https://t.me/c/2373696859/1605"),
    "gay_board": (-1003770334893, "https://t.me/c/3770334893/4"),
}
BOT_USERNAME = "GayBBS_bot"


def psql(sql: str) -> str:
    return subprocess.check_output(
        ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-t", "-A", "-c", sql],
        text=True,
    ).strip()


def token() -> str:
    p = Path("/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt")
    return p.read_text(encoding="utf-8").strip()


def main() -> None:
    enable = "--enable" in sys.argv
    me = json.loads(urllib.request.urlopen(
        urllib.request.Request(f"https://api.telegram.org/bot{token()}/getMe", data=b"{}", method="POST"), timeout=30
    ).read())["result"]
    issued = {}
    for key, (chat_id, topic_url) in ROUTES.items():
        row = psql(f"SELECT start_url,enabled FROM online_gate_routes WHERE card_key='{key}'")
        if not row:
            suffix = secrets.token_urlsafe(18)[:24]
            start = f"online_{suffix}"
            digest = hashlib.sha256(start.encode()).hexdigest()
            url = f"https://t.me/{BOT_USERNAME}?start={start}"
            psql(
                "INSERT INTO online_gate_routes "
                f"(card_key,token_hash,start_url,chat_id,topic_url,verified_by,enabled) "
                f"VALUES ('{key}','{digest}','{url}',{chat_id},'{topic_url}',{me['id']},FALSE)"
            )
            row = f"{url}|f"
        url, en = row.split("|")
        issued[key] = {"start_url": url, "enabled": en == "t"}
    if enable:
        psql("UPDATE online_gate_routes SET enabled=TRUE WHERE card_key IN ('area_bbs','video_chat','gay_board')")
        for k in issued:
            issued[k]["enabled"] = True
    Path(__file__).with_name("online-gate-routes-result.json").write_text(
        json.dumps({"bot": f"@{BOT_USERNAME}", "routes": issued}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(issued, ensure_ascii=False))


if __name__ == "__main__":
    main()
