#!/usr/bin/env python3
"""No-Telegram-network contract tests for bounded topic entry audit."""
import asyncio
import unittest
from types import SimpleNamespace

from userbot_topic_entry_audit import audit, posting_entry, AREA_CHAT, CATEGORY_CHAT


def button(text, url):
    return SimpleNamespace(text=text, url=url)


class PostingEntryClassifierTests(unittest.TestCase):
    def test_own_pinned_post_button_is_detected(self):
        msg = SimpleNamespace(sender_id=101, buttons=[[
            button("📝 投稿はこちら", "https://t.me/GayBBS_bot?start=m_abc")
        ]])
        self.assertTrue(posting_entry(msg, 101))

    def test_foreign_user_identical_button_is_not_accepted(self):
        msg = SimpleNamespace(sender_id=999, buttons=[[
            button("投稿はこちら", "https://t.me/GayBBS_bot?start=m_abc")
        ]])
        self.assertFalse(posting_entry(msg, 101))

    def test_unrelated_url_or_text_is_not_accepted(self):
        for text, url in [
            ("投稿はこちら", "https://t.me/unrelated_bot?start=x"),
            ("グループへ戻る", "https://t.me/GayBBS_bot?start=m_abc"),
            ("投稿はこちら", "https://evil.example/t.me/GayBBS_bot?start=x"),
            ("投稿はこちら", "https://t.me/GayBBS_bot?start="),
        ]:
            msg = SimpleNamespace(sender_id=101, buttons=[[button(text, url)]])
            self.assertFalse(posting_entry(msg, 101))

    def test_no_buttons_is_not_accepted(self):
        self.assertFalse(posting_entry(SimpleNamespace(sender_id=101, buttons=None), 101))


class ReadOnlyScopeTests(unittest.TestCase):
    def test_other_groups_are_rejected_before_telegram_access(self):
        class NoTelegram:
            def __getattr__(self, name):
                raise AssertionError("Telegram access must not occur")
        for chat_id in (-1002373696859, -1001, 0, True, "area"):
            with self.assertRaisesRegex(ValueError, "TOPIC_AUDIT_CHAT_NOT_ALLOWED"):
                asyncio.run(audit(NoTelegram(), chat_id, 0))
        for page in (-1, 25, True, "0"):
            with self.assertRaisesRegex(ValueError, "TOPIC_AUDIT_PAGE_INVALID"):
                asyncio.run(audit(NoTelegram(), AREA_CHAT, page))


if __name__ == "__main__":
    unittest.main()
