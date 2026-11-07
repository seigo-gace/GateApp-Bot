#!/usr/bin/env python3
"""Align DB questions with gaybbsApproval APPROVAL_QUESTIONS (entry_group targets 3,4,5)."""
from __future__ import annotations

import json
import subprocess

Q1 = (
    "こちらは男性同士の交流を目的としたゲイコミュニティです。\n\n"
    "参加対象は、18歳以上で、男性（FTMの方を含む）として男性との性的な関係を持てる方です。\n\n"
    "女性の方、参加条件に該当しない異性愛者の方、営業・勧誘・金銭目的で参加する方は対象外です。\n\n"
    "あなたはすべての参加条件を満たし、商用目的ではなく参加しますか？"
)
Q2 = (
    "当コミュニティでは、皆さんが安心して交流できるよう、利用規約・禁止事項・プライバシーポリシーを定めています。\n\n"
    "参加前に、以下のリンクから規約・規則の全文をご確認ください。\n\n"
    "規約・規則の内容を確認し、すべて遵守することに同意しますか？"
)


def psql(sql: str) -> None:
    subprocess.check_call(
        ["docker", "exec", "deploy-postgres-1", "psql", "-U", "gace", "-d", "gaybbs", "-c", sql]
    )


def main() -> None:
    rows = [
        (1, Q1, "✅ はい、参加条件を満たしています", "❌ いいえ、条件を満たしていません"),
        (2, Q2, "✅ はい、確認して同意します", "❌ いいえ、同意しません"),
    ]
    for idx, body, yes, no in rows:
        esc = body.replace("'", "''")
        psql(
            f"UPDATE questions SET question_text='{esc}', button1_label='{yes}', "
            f"button2_label='{no}', correct_button=1, enabled=true "
            f"WHERE target_id IN (3,4,5) AND order_index={idx};"
        )
    print(json.dumps({"status": "ok", "targets": [3, 4, 5]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
