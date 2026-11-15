#!/usr/bin/env python3
"""Offline contract checks; no resident socket, Telegram session, or network."""
from __future__ import annotations

import asyncio
import struct
import unittest
import zlib
from types import SimpleNamespace
from userbot_notice_smoke import PREVIEW_ROWS, png_image, run
from userbot_resident_ipc import ACTIONS


class NotBot:
    async def get_entity(self, name):
        if name != "GayBBS_bot":
            raise AssertionError("UNEXPECTED_TEST_TARGET")
        return SimpleNamespace(bot=False)


class NoticeSmokeContractTests(unittest.TestCase):
    def test_only_explicit_non_public_notice_test_is_allowlisted(self):
        self.assertIn("notice_private_smoke", ACTIONS)
        self.assertNotIn("notice_public_post_smoke", ACTIONS)

    def test_required_preview_buttons_are_exact(self):
        self.assertEqual(PREVIEW_ROWS, [
            ["日時設定", "期限設定", "参加方法"],
            ["画像/動画変更", "🔗ボタン", "下書き保存"],
            ["投稿する", "キャンセル"],
        ])

    def test_generated_photo_is_real_png_and_does_not_require_a_file(self):
        raw = png_image().read()
        self.assertEqual(raw[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", raw[16:24]), (64, 64))
        self.assertIn(b"IDAT", raw)
        self.assertGreater(len(raw), 50)

    def test_invalid_bot_stops_before_sending_any_message(self):
        out = asyncio.run(run(NotBot()))
        self.assertEqual(out["status"], "FAIL")
        self.assertEqual(out["error"], "NOTICE_TARGET_NOT_BOT")


if __name__ == "__main__":
    unittest.main()
