#!/usr/bin/env python3
"""SQL-only menu ledger (no Telegram sendMessage, no feature_release_gates, no documents).

Master #6715990636: verified topics, nav links, posting static URLs, board_menu_panels only.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LEDGER = json.loads((ROOT / "menu-topic-ledger-v1.json").read_text(encoding="utf-8"))
ADMIN = int(LEDGER["admin_telegram_id"])

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

BOOTSTRAP_LINK_KEYS = ("guideline", "terms", "privacy", "rules")


def sql_quote(s: str) -> str:
    return s.replace("'", "''")


def build_sql() -> str:
    chunks: list[str] = ["BEGIN;"]
    for row in LEDGER["general_guide_topics"]:
        cid, tid = int(row["chat_id"]), int(row["message_thread_id"])
        chunks.append(
            f"""
            INSERT INTO general_guide_topics(chat_id,message_thread_id,verified_by,enabled)
            VALUES ({cid},{tid},{ADMIN},TRUE)
            ON CONFLICT (chat_id) DO UPDATE SET
              message_thread_id=EXCLUDED.message_thread_id,
              verified_by=EXCLUDED.verified_by,
              verified_at=NOW(), enabled=TRUE;
            """
        )
        keys = ",".join(f"'{k}'" for k in BOOTSTRAP_LINK_KEYS)
        chunks.append(
            f"""
            UPDATE general_guide_links SET enabled=FALSE
            WHERE chat_id={cid} AND link_key IN ({keys}) AND source='pages.dev';
            """
        )
        comm = (
            "SELECT destination_url FROM general_guide_links "
            f"WHERE chat_id={cid} AND link_key='community' AND enabled=TRUE LIMIT 1"
        )
        chunks.append(f"-- community URL resolved at runtime for chat {cid}: ({comm})")
        for key, label, url in GUIDE_NAV[cid]:
            chunks.append(
                f"""
                INSERT INTO general_guide_links
                  (chat_id,link_key,label,destination_url,source,verified_by,verified_at,enabled)
                VALUES ({cid},'{sql_quote(key)}','{sql_quote(label)}','{sql_quote(url)}',
                        'menu-ledger-v1',{ADMIN},NOW(),TRUE)
                ON CONFLICT (chat_id,link_key) DO UPDATE SET
                  label=EXCLUDED.label,destination_url=EXCLUDED.destination_url,
                  verified_by=EXCLUDED.verified_by,verified_at=NOW(),enabled=TRUE;
                """
            )
        chunks.append(
            f"""
            INSERT INTO board_menu_panels
              (chat_id,message_thread_id,panel_type,state,verified_by,verified_at)
            VALUES ({cid},{tid},'general_guide','verified',{ADMIN},NOW())
            ON CONFLICT (chat_id,message_thread_id,panel_type) DO UPDATE SET
              verified_by=EXCLUDED.verified_by,verified_at=NOW(),
              state=CASE WHEN board_menu_panels.state='published' THEN 'published'
                         ELSE 'verified' END;
            """
        )

    for row in LEDGER["posting_menu_topics"]:
        cid, tid = int(row["chat_id"]), int(row["message_thread_id"])
        for label, url in POSTING_STATIC[cid]:
            chunks.append(
                f"""
                INSERT INTO board_posting_menu_links
                  (chat_id,label,destination_url,source,verified_by,verified_at,enabled)
                VALUES ({cid},'{sql_quote(label)}','{sql_quote(url)}','menu-ledger-v1',{ADMIN},NOW(),TRUE)
                ON CONFLICT (chat_id,label) DO UPDATE SET
                  destination_url=EXCLUDED.destination_url,
                  verified_by=EXCLUDED.verified_by,verified_at=NOW(),enabled=TRUE;
                """
            )
        chunks.append(
            f"""
            INSERT INTO board_menu_panels
              (chat_id,message_thread_id,panel_type,state,verified_by,verified_at)
            VALUES ({cid},{tid},'posting','verified',{ADMIN},NOW())
            ON CONFLICT (chat_id,message_thread_id,panel_type) DO UPDATE SET
              verified_by=EXCLUDED.verified_by,verified_at=NOW(),
              state=CASE WHEN board_menu_panels.state='published' THEN 'published'
                         ELSE 'verified' END;
            """
        )
    chunks.append("COMMIT;")
    return "\n".join(chunks)


def apply_with_community_resolution(sql: str) -> None:
    """Attach enabled community gate URL per chat before running SQL."""
    out = sql
    for row in LEDGER["general_guide_topics"]:
        cid = int(row["chat_id"])
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
                "-c",
                f"SELECT destination_url FROM general_guide_links WHERE chat_id={cid} "
                "AND link_key='community' AND enabled=TRUE LIMIT 1;",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        comm = proc.stdout.strip()
        if not comm:
            raise RuntimeError(f"community_link_missing chat_id={cid}")
        tid = int(row["message_thread_id"])
        out += f"""
        INSERT INTO general_guide_links
          (chat_id,link_key,label,destination_url,source,verified_by,verified_at,enabled)
        VALUES ({cid},'community','コミュニティリンク','{sql_quote(comm)}','gate',{ADMIN},NOW(),TRUE)
        ON CONFLICT (chat_id,link_key) DO UPDATE SET
          destination_url=EXCLUDED.destination_url,enabled=TRUE,
          verified_by=EXCLUDED.verified_by,verified_at=NOW();
        """
        _ = tid
    proc = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            "deploy-postgres-1",
            "psql",
            "-U",
            "gace",
            "-d",
            "gaybbs",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input=out.encode(),
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql_failed rc={proc.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print SQL only")
    parser.add_argument("--apply", action="store_true", help="Execute against deploy-postgres-1")
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        parser.print_help()
        return 2
    sql = build_sql()
    if args.dry_run:
        print(sql)
        return 0
    apply_with_community_resolution(sql)
    out = ROOT / "menu-ledger-sql-apply-result.json"
    out.write_text(
        json.dumps(
            {
                "schema": "tgtumbler.menu-ledger-sql-apply/v1",
                "applied": True,
                "master_ref": "issues/7#issuecomment-6715990636",
                "skipped": ["general_guide_documents", "gaybbs_feature_release_gates", "sendMessage"],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"status": "sql_applied", "receipt": str(out)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
