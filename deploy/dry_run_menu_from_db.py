#!/usr/bin/env python3
"""DB preflight for menu publish: facts only, no Telegram send."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GUIDE_LABELS = [
    "お知らせ",
    "フリートーク/雑談",
    "全国エリアボード",
    "カテゴリーボード",
    "ビデオチャット/動画",
    "検索/フィルター",
    "みんなのプロフ",
    "コミュニティリンク",
    "グループルール",
    "使い方",
    "安全ガイド",
    "利用規約",
]
POSTING_NAV = ["クリエーター有料ビデオ投稿", "雑談", "紹介/招待"]
POSTING_ENTRY = [
    "相手募集",
    "募集+Room",
    "告知/予告",
    "🔗ボタン作成",
    "検索/フィルター",
    "操作説明",
]
DOC_TYPES = ["terms", "rules", "safety", "privacy", "howto"]
CHATS = [-1003847210571, -1002373696859, -1003770334893]


def psql_json(sql: str) -> list[dict]:
    proc = subprocess.run(
        [
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
            "-F",
            ",",
            "-c",
            sql,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    rows = []
    for line in proc.stdout.strip().splitlines():
        if not line.strip():
            continue
        parts = line.split(",")
        rows.append(parts)
    return rows


def main() -> None:
    report = {
        "schema": "tgtumbler.menu-db-dry-run/v1",
        "master_ref": "issues/7#issuecomment-6720049968",
        "renderer_contract_tests": "artifacts/bot/tests/menuPanelRenderer.test.ts (2x6, 3-1-2-3 layout)",
        "boards": [],
        "gates": int(psql_json("SELECT COUNT(*) FROM gaybbs_feature_release_gates WHERE enabled=TRUE;")[0][0]),
    }
    for cid in CHATS:
        docs = psql_json(
            f"SELECT document_type,message_id,status FROM general_guide_documents WHERE chat_id={cid};"
        )
        doc_map = {r[0]: r for r in docs}
        missing_docs = [t for t in DOC_TYPES if t not in doc_map or doc_map[t][2] != "published"]
        links = psql_json(
            f"SELECT label FROM general_guide_links WHERE chat_id={cid} AND enabled=TRUE ORDER BY link_key;"
        )
        link_labels = {r[0] for r in links}
        need_nav = set(GUIDE_LABELS) - {"グループルール", "使い方", "安全ガイド", "利用規約"}
        missing_nav = sorted(need_nav - link_labels)
        posting_links = psql_json(
            f"SELECT label FROM board_posting_menu_links WHERE chat_id={cid} AND enabled=TRUE;"
        )
        pl = {r[0] for r in posting_links}
        missing_post_nav = sorted(set(POSTING_NAV) - pl)
        report["boards"].append(
            {
                "chat_id": cid,
                "general_guide_publishable": not missing_docs and not missing_nav,
                "missing_documents": missing_docs,
                "missing_nav_labels": missing_nav,
                "posting_nav_complete": not missing_post_nav,
                "missing_posting_nav": missing_post_nav,
                "posting_entry_buttons_expected": POSTING_ENTRY,
                "posting_publishable": not missing_post_nav and report["gates"] >= 5,
                "blockers": [
                    *(["GUIDE_DOCUMENTS"] if missing_docs else []),
                    *(["GUIDE_NAV"] if missing_nav else []),
                    *(["POSTING_NAV"] if missing_post_nav else []),
                    *(["FEATURE_GATES"] if report["gates"] < 5 else []),
                ],
            }
        )
    out = ROOT / "menu-db-dry-run-20261108.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"receipt": str(out), "any_publishable": any(b["general_guide_publishable"] for b in report["boards"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
