#!/usr/bin/env python3
"""Set exactly three TGtumbler group descriptions using existing original texts.

Source of truth:
  deploy/community-intro-texts.json (already published verbatim intro)
  artifacts/bot/deploy/community-post-assets.json (existing Gate URLs)
Default is READ-ONLY preview; --apply requires existing Bot admin permissions.
Never generate, trim, or paraphrase Master-approved introductions.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTRO_PATH = ROOT / "deploy/community-intro-texts.json"
ASSET_PATH = ROOT / "artifacts/bot/deploy/community-post-assets.json"
BOARD_TARGETS = {
    "areas_bbs": -1003847210571,
    "video_chat": -1002373696859,
    "gay_board": -1003770334893,
}
GATE_PATTERN = re.compile(r"https://t\.me/[A-Za-z][A-Za-z0-9_]{4,31}\?start=gate_[A-Za-z0-9_-]{1,64}\Z")


def api(token: str, method: str, data: dict) -> dict:
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(data, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{method} HTTP {exc.code}") from None
    if not result.get("ok"):
        raise RuntimeError(f"{method} Telegram API returned error {result.get('error_code')}")
    return result["result"]


def plan() -> list[dict]:
    intros = json.loads(INTRO_PATH.read_text(encoding="utf-8"))["entries"]
    entries = json.loads(ASSET_PATH.read_text(encoding="utf-8"))["entries"]
    if len(entries) < 3:
        raise ValueError("COMMUNITY_ASSET_INCOMPLETE")
    links = {x["key"]: x["entry_url"] for x in entries}
    rows = []
    for key, chat_id in BOARD_TARGETS.items():
        if key not in intros or key not in links:
            raise ValueError(f"GROUP_OFFICIAL_SOURCE_MISSING:{key}")
        original = intros[key]  # exact existing Master-provided text
        gate = links[key]  # exact registered, already-published group GATE link
        if not original or original != original.strip():
            raise ValueError(f"GROUP_OFFICIAL_TEXT_INVALID:{key}")
        if not GATE_PATTERN.fullmatch(gate):
            raise ValueError(f"GROUP_GATE_INVALID:{key}")
        description = original + "\n\n🔗参加はこちら\n" + gate
        if len(description) > 255:
            raise ValueError(f"GROUP_DESCRIPTION_EXCEEDS_255:{key}:{len(description)}")
        if description.count("https://") != 1:
            raise ValueError(f"GROUP_DESCRIPTION_URL_COUNT:{key}")
        rows.append({"key": key, "chat_id": chat_id, "description": description,
                     "chars": len(description), "gate_url": gate})
    return rows


def run(apply: bool) -> None:
    rows = plan()
    if not apply:
        for row in rows:
            print(json.dumps({"status": "PREVIEW_ONLY", **row}, ensure_ascii=False))
        print("No Telegram API changes. Use --apply with existing authorized Runtime.")
        return
    token_file = os.environ.get(
        "BOT_TOKEN_FILE",
        "/home/gace/server-core/projects/TGtumbler/GateApp-Bot/deploy/secrets/bot_token.txt",
    )
    token = os.environ.get("BOT_TOKEN") or Path(token_file).read_text(encoding="utf-8").strip()
    me = api(token, "getMe", {})
    if me.get("username", "").lower() != "gaybbs_bot":
        raise RuntimeError("GROUP_DESCRIPTION_WRONG_BOT_IDENTITY")
    # No mutation until all three chats and admin privileges have been checked.
    for row in rows:
        chat = api(token, "getChat", {"chat_id": row["chat_id"]})
        if int(chat["id"]) != row["chat_id"] or chat.get("type") != "supergroup":
            raise RuntimeError(f"GROUP_DESCRIPTION_WRONG_CHAT:{row['key']}")
        member = api(token, "getChatMember", {"chat_id": row["chat_id"], "user_id": me["id"]})
        if member.get("status") not in ("administrator", "creator"):
            raise RuntimeError(f"GROUP_DESCRIPTION_BOT_NOT_ADMIN:{row['key']}")
        if member.get("status") == "administrator" and not member.get("can_change_info"):
            raise RuntimeError(f"GROUP_DESCRIPTION_BOT_LACKS_CHANGE_INFO:{row['key']}")
        row["before"] = chat.get("description", "")
    changed = 0
    for row in rows:
        if row["description"] != row["before"]:
            api(token, "setChatDescription", {"chat_id": row["chat_id"], "description": row["description"]})
            changed += 1
        verified = api(token, "getChat", {"chat_id": row["chat_id"]})
        if verified.get("description") != row["description"]:
            raise RuntimeError(f"GROUP_DESCRIPTION_READBACK_MISMATCH:{row['key']} (changed={changed})")
        print(json.dumps({"key": row["key"], "status": "READBACK_PASS",
                          "chat_id": row["chat_id"], "chars": row["chars"]}, ensure_ascii=False))
    print(f"GROUP_DESCRIPTIONS_READBACK_PASS count={len(rows)} changed={changed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Use authorized existing Bot and write descriptions")
    run(parser.parse_args().apply)
