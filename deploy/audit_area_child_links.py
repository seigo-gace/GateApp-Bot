#!/usr/bin/env python3
"""List verified vs missing child area topic URLs against AREA_BLOCKS."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

AREA_BLOCKS_SNIPPET = Path(__file__).resolve().parents[1] / "artifacts/bot/src/services/topicBoardContent.ts"


def psql_lines(sql: str) -> list[str]:
    proc = subprocess.run(
        ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-t", "-A", "-c", sql],
        capture_output=True,
        text=True,
        check=True,
    )
    return [x for x in proc.stdout.splitlines() if x.strip()]


def main() -> int:
    db: dict[str, str] = {}
    for line in psql_lines("SELECT block_name||'/'||area_name||'|'||target_url FROM topic_board_area_links;"):
        block, url = line.split("|", 1)
        db[block] = url
    src = AREA_BLOCKS_SNIPPET.read_text(encoding="utf-8")
    children: list[tuple[str, str, str | None]] = []
    block = None
    for raw in src.splitlines():
        m = re.search(r'\{ label: "([^"]+)", url: c\(AREA, (\d+)\)', raw)
        if m and "AREA_BLOCKS" in src[: src.find(raw)]:
            block = m.group(1)
        m2 = re.search(r'\{ label: "([^"]+)"(?:, url: c\(AREA, (\d+)\))?\ }', raw)
        if m2 and block and "children" in raw:
            children.append((block, m2.group(1), f"https://t.me/c/3847210571/{m2.group(2)}" if m2.group(2) else None))
    missing: list[str] = []
    verified: list[str] = []
    for blk, child, inline in children:
        if blk in ("北海道", "沖縄") and child == blk:
            continue
        key = f"{blk}/{child}"
        url = inline or db.get(key)
        if url:
            verified.append(key)
        else:
            missing.append(key)
    out = {
        "verified_count": len(verified),
        "missing_count": len(missing),
        "missing_keys": missing,
    }
    path = Path(__file__).resolve().parent / "area-child-link-audit.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
