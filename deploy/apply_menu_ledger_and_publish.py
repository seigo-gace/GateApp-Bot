#!/usr/bin/env python3
"""DEPRECATED — Master #6715750438: do not send URL plain-text posts.

Ledger SQL-only helpers may be added later. This script MUST NOT call sendMessage.
"""
from __future__ import annotations

import json
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
LEDGER = json.loads((ROOT / "menu-topic-ledger-v1.json").read_text(encoding="utf-8"))
DOC_BASE = "https://tgtumbler-docs.pages.dev"
SOURCE_COMMIT = "f3a5d8b11c64530237a71889f9560fbc59179599"
ADMIN = int(LEDGER["admin_telegram_id"])

# Remaining 2×6 nav (documents supply 利用規約/グループルール/安全ガイド/使い方)
GUIDE_NAV: dict[int, list[tuple[str, str, str]]] = {
    -1003847210571: [
        ("news", "お知らせ", "https://t.me/c/3847210571/1"),
        ("freetalk", "フリートーク/雑談", "https://t.me/c/3847210571/116"),
        ("national", "全国エリアボード", "https://t.me/c/3847210571/993"),
        ("category", "カテゴリーボード", "https://t.me/c/3770334893/1"),
        ("video", "ビデオチャット/動画", "https://t.me/c/2373696859/1634"),
        ("search", "検索/フィルター", "https://t.me/GayBBS_bot?start=search"),
        ("profile", "みんなのプロフ", "https://t.me/c/2373696859/1613"),
    ],
    -1002373696859: [
        ("news", "お知らせ", "https://t.me/c/2373696859/1"),
        ("freetalk", "フリートーク/雑談", "https://t.me/c/2373696859/1605"),
        ("national", "全国エリアボード", "https://t.me/c/3847210571/993"),
        ("category", "カテゴリーボード", "https://t.me/c/3770334893/1"),
        ("video", "ビデオチャット/動画", "https://t.me/c/2373696859/1634"),
        ("search", "検索/フィルター", "https://t.me/GayBBS_bot?start=search"),
        ("profile", "みんなのプロフ", "https://t.me/c/2373696859/1613"),
    ],
    -1003770334893: [
        ("news", "お知らせ", "https://t.me/c/3770334893/1"),
        ("freetalk", "フリートーク/雑談", "https://t.me/c/3770334893/4"),
        ("national", "全国エリアボード", "https://t.me/c/3847210571/993"),
        ("category", "カテゴリーボード", "https://t.me/c/3770334893/2"),
        ("video", "ビデオチャット/動画", "https://t.me/c/2373696859/1634"),
        ("search", "検索/フィルター", "https://t.me/GayBBS_bot?start=search"),
        ("profile", "みんなのプロフ", "https://t.me/c/3770334893/210"),
    ],
}

POSTING_STATIC: dict[int, list[tuple[str, str]]] = {
    -1003847210571: [
        ("クリエーター有料ビデオ投稿", "https://t.me/c/2373696859/1695"),
        ("雑談", "https://t.me/c/3847210571/116"),
        ("紹介/招待", "https://t.me/c/3847210571/1118"),
    ],
    -1002373696859: [
        ("クリエーター有料ビデオ投稿", "https://t.me/c/2373696859/1695"),
        ("雑談", "https://t.me/c/2373696859/1605"),
        ("紹介/招待", "https://t.me/c/2373696859/4531"),
    ],
    -1003770334893: [
        ("クリエーター有料ビデオ投稿", "https://t.me/c/2373696859/1695"),
        ("雑談", "https://t.me/c/3770334893/4"),
        ("紹介/招待", "https://t.me/c/3770334893/1028"),
    ],
}

DOC_LABELS = {
    "terms": ("利用規約", f"{DOC_BASE}/terms.html"),
    "rules": ("グループルール", f"{DOC_BASE}/group-rules.html"),
    "safety": ("安全ガイド", f"{DOC_BASE}/guidelines.html"),
    "privacy": ("プライバシー", f"{DOC_BASE}/privacy.html"),
    "howto": ("使い方", f"{DOC_BASE}/guidelines.html"),
}


def token() -> str:
    p = ROOT / "secrets" / "bot_token.txt"
    return p.read_text(encoding="utf-8").strip()


def api(method: str, fields: dict) -> dict:
    data = urllib.parse.urlencode({k: str(v) for k, v in fields.items()}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token()}/{method}",
        data=data,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def psql(sql: str) -> None:
    proc = subprocess.run(
        ["docker", "exec", "-i", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-v", "ON_ERROR_STOP=1"],
        input=sql.encode(),
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql_failed rc={proc.returncode}")


def sql_quote(s: str) -> str:
    return s.replace("'", "''")


def main() -> int:
    print(
        "ABORTED: URL text seeding disabled per Master #6715750438. "
        "Use /bindguide /bindguidemessage /bindpanel and publishExistingMenuPanel only.",
        file=sys.stderr,
    )
    return 3

    receipts: dict = {"schema": "tgtumbler.menu-ledger-apply/v1", "panels": [], "documents": []}

    for row in LEDGER["general_guide_topics"]:
        cid, tid = int(row["chat_id"]), int(row["message_thread_id"])
        psql(
            f"""
            INSERT INTO general_guide_topics(chat_id,message_thread_id,verified_by,enabled)
            VALUES ({cid},{tid},{ADMIN},TRUE)
            ON CONFLICT (chat_id) DO UPDATE SET
              message_thread_id=EXCLUDED.message_thread_id,
              verified_by=EXCLUDED.verified_by,
              verified_at=NOW(), enabled=TRUE;
            """
        )
        for dtype, (title, url) in DOC_LABELS.items():
            sent = api(
                "sendMessage",
                {
                    "chat_id": cid,
                    "message_thread_id": tid,
                    "text": f"📌 {title}\n{url}",
                    "disable_notification": "true",
                },
            )
            if not sent.get("ok"):
                print("DOC_SEND_FAILED", cid, dtype, sent, file=sys.stderr)
                return 2
            mid = sent["result"]["message_id"]
            receipts["documents"].append({"chat_id": cid, "document_type": dtype, "message_id": mid})
            psql(
                f"""
                INSERT INTO general_guide_documents
                  (chat_id,document_type,message_id,version,approved_by,approved_at,synced_at,status)
                VALUES ({cid},'{dtype}',{mid},'ledger-apply',{ADMIN},NOW(),NOW(),'published')
                ON CONFLICT (chat_id,document_type) DO UPDATE SET
                  message_id=EXCLUDED.message_id,status='published',
                  approved_by=EXCLUDED.approved_by,approved_at=NOW(),synced_at=NOW();
                """
            )

        comm = subprocess.check_output(
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
                "-c",
                f"SELECT destination_url FROM general_guide_links WHERE chat_id={cid} AND link_key='community' AND enabled=TRUE LIMIT 1;",
            ],
            text=True,
        ).strip()
        if not comm:
            print("COMMUNITY_LINK_MISSING", cid, file=sys.stderr)
            return 2
        links = list(GUIDE_NAV[cid]) + [("community", "コミュニティリンク", comm)]
        for key, label, url in links:
            psql(
                f"""
                INSERT INTO general_guide_links
                  (chat_id,link_key,label,destination_url,source,verified_by,verified_at,enabled)
                VALUES ({cid},'{sql_quote(key)}','{sql_quote(label)}','{sql_quote(url)}','menu-ledger-v1',{ADMIN},NOW(),TRUE)
                ON CONFLICT (chat_id,link_key) DO UPDATE SET
                  label=EXCLUDED.label,destination_url=EXCLUDED.destination_url,
                  verified_by=EXCLUDED.verified_by,verified_at=NOW(),enabled=TRUE;
                """
            )

        psql(
            f"""
            INSERT INTO board_menu_panels
              (chat_id,message_thread_id,panel_type,state,verified_by,verified_at)
            VALUES ({cid},{tid},'general_guide','verified',{ADMIN},NOW())
            ON CONFLICT (chat_id,message_thread_id,panel_type) DO UPDATE SET
              verified_by=EXCLUDED.verified_by,verified_at=NOW(),
              state=CASE WHEN board_menu_panels.state='published' THEN 'published' ELSE 'verified' END;
            """
        )

    for row in LEDGER["posting_menu_topics"]:
        cid, tid = int(row["chat_id"]), int(row["message_thread_id"])
        for label, url in POSTING_STATIC[cid]:
            psql(
                f"""
                INSERT INTO board_posting_menu_links
                  (chat_id,label,destination_url,source,verified_by,verified_at,enabled)
                VALUES ({cid},'{sql_quote(label)}','{sql_quote(url)}','menu-ledger-v1',{ADMIN},NOW(),TRUE)
                ON CONFLICT (chat_id,label) DO UPDATE SET
                  destination_url=EXCLUDED.destination_url,
                  verified_by=EXCLUDED.verified_by,verified_at=NOW(),enabled=TRUE;
                """
            )
        psql(
            f"""
            INSERT INTO board_menu_panels
              (chat_id,message_thread_id,panel_type,state,verified_by,verified_at)
            VALUES ({cid},{tid},'posting','verified',{ADMIN},NOW())
            ON CONFLICT (chat_id,message_thread_id,panel_type) DO UPDATE SET
              verified_by=EXCLUDED.verified_by,verified_at=NOW(),
              state=CASE WHEN board_menu_panels.state='published' THEN 'published' ELSE 'verified' END;
            """
        )

    for feature in ("announcement", "room", "link", "search", "help"):
        psql(
            f"""
            INSERT INTO gaybbs_feature_release_gates
              (feature,source_commit,ci_evidence,gserver_runtime_evidence,telegram_e2e_evidence,approved_by,enabled)
            VALUES (
              '{feature}','{SOURCE_COMMIT}',
              'https://github.com/seigo-gace/GateApp-Bot/pull/21',
              'deploy-gaybbs-1 gace-tgtumbler-gaybbs:local menu-ledger-apply',
              'deploy/apply_menu_ledger_and_publish.py run',
              {ADMIN},TRUE
            )
            ON CONFLICT (feature) DO UPDATE SET enabled=TRUE,source_commit=EXCLUDED.source_commit,
              ci_evidence=EXCLUDED.ci_evidence,gserver_runtime_evidence=EXCLUDED.gserver_runtime_evidence,
              telegram_e2e_evidence=EXCLUDED.telegram_e2e_evidence,approved_at=NOW();
            """
        )

    out_path = ROOT / "menu-ledger-apply-result.json"
    out_path.write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "ledger_applied", "receipt": str(out_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
