#!/usr/bin/env python3
"""Offline contract tests. No Telegram session, network or G-drive needed."""
import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
import userbot_public_video_actions as actions


class FakeClient:
    def __init__(self):
        self.channel = SimpleNamespace(id=42, username="public_test_channel", title="Public", megagroup=False)
        self.group = SimpleNamespace(id=43, username="group_test", title="Group", megagroup=True)
        self.messages = [
            SimpleNamespace(id=8, video=SimpleNamespace(size=11), file=SimpleNamespace(ext=".mp4"), media="video", raw_text="原文", date=datetime(2026, 11, 14, tzinfo=timezone.utc)),
            SimpleNamespace(id=7, video=None, raw_text="text", date=None),
        ]

    async def iter_dialogs(self):
        yield SimpleNamespace(is_channel=True, entity=self.channel)
        yield SimpleNamespace(is_channel=True, entity=self.group)

    async def iter_messages(self, entity, limit):
        for item in self.messages:
            yield item

    async def get_messages(self, entity, ids):
        return next((m for m in self.messages if m.id == ids), None)


class PublicVideoTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_joined_broadcast_channels(self):
        c = await actions.joined_public_channels(FakeClient())
        self.assertEqual([item["id"] for item in c], [42])

    async def test_video_metadata_no_text_messages(self):
        videos = await actions.channel_videos(FakeClient(), 42, 10)
        self.assertEqual([item["messageId"] for item in videos], [8])
        self.assertEqual(videos[0]["caption"], "原文")

    async def test_reject_nonjoined_channel(self):
        with self.assertRaisesRegex(ValueError, "PUBLIC_JOINED_CHANNEL_NOT_FOUND"):
            await actions.channel_videos(FakeClient(), 99, 10)

    async def test_reject_invalid_limits_and_ids(self):
        with self.assertRaises(ValueError):
            await actions.channel_videos(FakeClient(), 42, 0)
        with self.assertRaises(ValueError):
            await actions.download_video(FakeClient(), 42, True)

    async def test_download_rejects_missing_storage_without_writes(self):
        with patch.object(actions, "STORAGE_ROOT") as root:
            root.is_dir.return_value = False
            root.is_symlink.return_value = False
            with self.assertRaisesRegex(RuntimeError, "GSERVER_STORAGE_NOT_MOUNTED"):
                await actions.download_video(FakeClient(), 42, 8)


if __name__ == "__main__":
    unittest.main()
