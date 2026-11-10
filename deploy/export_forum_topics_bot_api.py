#!/usr/bin/env python3
"""Export forum topic ID / title / URL for TGtumbler 3 groups using Telegram Bot API.

FACT: api.telegram.org does not implement getForumTopics (HTTP 404). This script
tries it first, then uses getChat plus ledger-derived thread candidates and
optional sendMessage+deleteMessage reachability probes. Live topic titles are
merged from verified ledgers (Master/issue comments and topicBoardContent); Bot
API has no method to read historical forum topic names.
"""
from __future__ import annotations

import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOPIC_TS = ROOT.parent / "artifacts/bot/src/services/topicBoardContent.ts"
GENERAL_NAV_TS = ROOT.parent / "artifacts/bot/src/services/generalGuideNavLinks.ts"

GROUPS = [
    ("area_bbs", -1003847210571, "3847210571"),
    ("video_chat", -1002373696859, "2373696859"),
    ("gay_board", -1003770334893, "3770334893"),
]
TME = re.compile(r"https://t\.me/c/(\d+)/(\d+)")


def token() -> str:
    return (ROOT / "secrets" / "bot_token.txt").read_text(encoding="utf-8").strip()


def api(method: str, fields: dict | None = None) -> dict:
    fields = fields or {}
    if method in {"getUpdates"} and not fields:
        url = f"https://api.telegram.org/bot{token()}/{method}"
        req = urllib.request.Request(url, method="GET")
    else:
        data = urllib.parse.urlencode({k: str(v) for k, v in fields.items()}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token()}/{method}",
            data=data,
            method="POST",
        )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"ok": False, "error_code": exc.code, "description": body[:400]}
        if exc.code == 404:
            parsed.setdefault("http_status", 404)
        return parsed


def topic_url(chat_id: int, message_thread_id: int) -> str:
    suffix = str(chat_id).replace("-100", "", 1) if str(chat_id).startswith("-100") else str(chat_id).lstrip("-")
    return f"https://t.me/c/{suffix}/{message_thread_id}"


def probe_thread(chat_id: int, thread_id: int) -> bool:
    sent = api(
        "sendMessage",
        {
            "chat_id": chat_id,
            "message_thread_id": thread_id,
            "text": "🔒 TGtumbler topic inventory probe (deleted immediately)",
        },
    )
    if not sent.get("ok"):
        return False
    mid = int(sent["result"]["message_id"])
    api("deleteMessage", {"chat_id": chat_id, "message_id": mid})
    return True


def titles_from_area_master() -> dict[tuple[int, int], str]:
    path = ROOT / "area-topic-url-master-6725069736.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    chat_id = int(data["chat_id"])
    out: dict[tuple[int, int], str] = {}
    for label, url in {**data.get("block_urls", {}), **data.get("verified_children", {})}.items():
        m = TME.search(str(url))
        if m and f"-100{m.group(1)}" == str(chat_id):
            out[(chat_id, int(m.group(2)))] = label
    l0 = data.get("l0_row1_area") or {}
    for label, url in l0.items():
        if isinstance(url, str) and url.startswith("https://"):
            m = TME.search(url)
            if m and f"-100{m.group(1)}" == str(chat_id):
                out[(chat_id, int(m.group(2)))] = label
    return out


def titles_from_ts_board_entries() -> dict[tuple[int, int], str]:
    out: dict[tuple[int, int], str] = {}
    if not TOPIC_TS.is_file():
        return out
    text = TOPIC_TS.read_text(encoding="utf-8")
    for chat_suffix, sign in [("3847210571", -1003847210571), ("2373696859", -1002373696859), ("3770334893", -1003770334893)]:
        chat_id = sign
        for m in re.finditer(
            rf'label:\s*"([^"]+)"[^}}]*url:\s*c\(\w+,\s*(\d+)\)',
            text,
        ):
            label, tid = m.group(1), int(m.group(2))
            out[(chat_id, tid)] = label
        for m in TME.finditer(text):
            if m.group(1) == chat_suffix:
                # label unknown from URL alone
                out.setdefault((chat_id, int(m.group(2))), f"thread:{m.group(2)}")
    return out


def urls_from_repo_files() -> dict[tuple[int, int], list[str]]:
    """Collect (chat_id, thread_id) from JSON/TS under deploy + artifacts/bot."""
    roots = [ROOT, ROOT.parent / "artifacts/bot"]
    found: dict[tuple[int, int], list[str]] = {}
    chat_by_suffix = {s: cid for _, cid, s in GROUPS}
    patterns = ("*.json", "*.ts")
    for base in roots:
        if not base.is_dir():
            continue
        for pat in patterns:
            for path in base.rglob(pat):
                if ".pnpm-store" in str(path) or "node_modules" in str(path):
                    continue
                try:
                    body = path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                for m in TME.finditer(body):
                    suffix, tid = m.group(1), int(m.group(2))
                    cid = chat_by_suffix.get(suffix)
                    if cid is None:
                        continue
                    key = (cid, tid)
                    rel = str(path.relative_to(ROOT.parent))
                    found.setdefault(key, [])
                    if rel not in found[key]:
                        found[key].append(rel)
    return found


def titles_from_db() -> dict[tuple[int, int], str]:
    out: dict[tuple[int, int], str] = {}
    sql = """
    SELECT chat_id::bigint, message_thread_id::bigint, COALESCE(title,'') AS title
      FROM posting_topics WHERE enabled
    UNION ALL
    SELECT chat_id::bigint, message_thread_id::bigint, panel_type AS title
      FROM board_menu_panels WHERE state IN ('verified','published')
    UNION ALL
    SELECT chat_id::bigint, message_thread_id::bigint, board_key AS title
      FROM topic_board_posts;
    """
    try:
        proc = subprocess.run(
            ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-t", "-A", "-F", "|", "-c", sql],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return out
    if proc.returncode != 0:
        return out
    for line in proc.stdout.splitlines():
        parts = line.split("|")
        if len(parts) != 3:
            continue
        try:
            cid, tid = int(parts[0]), int(parts[1])
            title = parts[2].strip()
        except ValueError:
            continue
        if title:
            out[(cid, tid)] = title
    return out


def try_get_forum_topics(chat_id: int) -> dict:
    return api("getForumTopics", {"chat_id": chat_id, "limit": 100})


def main() -> int:
    title_maps = {}
    for src in (titles_from_area_master(), titles_from_ts_board_entries(), titles_from_db()):
        title_maps.update(src)

    url_sources = urls_from_repo_files()
    # Menu ledger extras
    menu = ROOT / "menu-topic-ledger-v1.json"
    if menu.is_file():
        ml = json.loads(menu.read_text(encoding="utf-8"))
        for section in ("general_guide_topics", "posting_menu_topics"):
            for row in ml.get(section, []):
                cid = int(row["chat_id"])
                tid = int(row["message_thread_id"])
                url_sources.setdefault((cid, tid), []).append("deploy/menu-topic-ledger-v1.json")

    receipt = {
        "schema": "tgtumbler.forum-topics-bot-api/v2",
        "exported_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "bot_api_base": "https://api.telegram.org",
        "limitations": {
            "getForumTopics": "Not available on api.telegram.org (HTTP 404); cannot list all live forum topics.",
            "topic_title_from_bot_api": "No getForumTopic; service messages cannot be copied/forwarded for title readback.",
            "title_fields_below": "title + title_source come from ledgers/DB when Bot API cannot supply names.",
        },
        "groups": [],
    }

    list_method_probe = try_get_forum_topics(GROUPS[0][1])
    receipt["getForumTopics_probe"] = {
        "chat_id": GROUPS[0][1],
        "ok": list_method_probe.get("ok", False),
        "error_code": list_method_probe.get("error_code"),
        "http_status": list_method_probe.get("http_status"),
        "description": list_method_probe.get("description"),
    }

    for board_key, chat_id, _suffix in GROUPS:
        chat_res = api("getChat", {"chat_id": chat_id})
        group_row = {
            "board_key": board_key,
            "chat_id": chat_id,
            "getChat": {
                "ok": chat_res.get("ok", False),
                "title": (chat_res.get("result") or {}).get("title"),
                "is_forum": (chat_res.get("result") or {}).get("is_forum"),
            },
            "topics": [],
        }
        threads = sorted({tid for (cid, tid) in url_sources if cid == chat_id})
        for tid in threads:
            title = title_maps.get((chat_id, tid))
            title_source = "ledger_or_db" if title else "unknown"
            if not title:
                title = f"(title_unknown:{tid})"
            reachable = probe_thread(chat_id, tid)
            time.sleep(0.05)
            group_row["topics"].append(
                {
                    "message_thread_id": tid,
                    "name": title,
                    "title_source": title_source,
                    "topic_url": topic_url(chat_id, tid),
                    "bot_send_probe_ok": reachable,
                    "evidence_files": url_sources.get((chat_id, tid), [])[:8],
                }
            )
        group_row["topic_count"] = len(group_row["topics"])
        group_row["reachable_count"] = sum(1 for t in group_row["topics"] if t["bot_send_probe_ok"])
        receipt["groups"].append(group_row)

    out = ROOT / "forum-topics-bot-api-export.json"
    out.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {
        "receipt": str(out),
        "groups": len(receipt["groups"]),
        "total_topics": sum(g["topic_count"] for g in receipt["groups"]),
        "getForumTopics_ok": receipt["getForumTopics_probe"]["ok"],
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
