import unittest
from unittest.mock import patch
from userbot_public_video_archive_all import archive_joined, catalog_channels


class AllJoinedTests(unittest.IsolatedAsyncioTestCase):
    def test_public_joined_only_and_target_first(self):
        items = [
            {"id": 4, "username": "ZZZZZ", "isPublic": True},
            {"id": 2, "username": "theGreatOldDaysofNipponGV", "isPublic": True},
            {"id": 3, "username": "private", "isPublic": False},
            {"id": 5, "username": "group", "isPublic": False},
            {"id": 4, "username": "duplicate", "isPublic": True},
        ]
        result = catalog_channels({"status": "PASS", "channels": items})
        self.assertEqual([r["id"] for r in result], [2, 4])

    async def test_all_channels_not_hard_capped(self):
        labels = [f"PublicChannel_{i:03d}" for i in range(125)]
        channels = [{"id": i+1, "username": username, "isPublic": True}
                    for i, username in enumerate(labels)]
        calls = []
        progress = []
        async def fake(action, **kwargs):
            if action == "list_joined_public_channels":
                return {"status": "PASS", "channels": channels}
            raise AssertionError(action)
        async def fake_archive(_call, username, on_progress):
            calls.append(username)
            return {"status": "complete", "discovered": 1, "saved": 1,
                    "already_present": 0, "failed": 0, "scanned": 1}
        with patch("userbot_public_video_archive_all.archive_all_channel", fake_archive):
            result = await archive_joined(fake, lambda s: progress.append(dict(s)))
        self.assertEqual(result["channels_total"], 125)
        self.assertEqual(result["channels_completed"], 125)
        self.assertEqual(len(calls), 125)
        self.assertEqual(result["status"], "complete")

    async def test_failed_channel_does_not_stop_others(self):
        channels = [{"id": 1, "username": "FirstOne", "isPublic": True},
                    {"id": 2, "username": "SecondOne", "isPublic": True}]
        async def fake(action, **_kwargs):
            return {"status": "PASS", "channels": channels}
        async def fake_archive(_call, username, on_progress):
            if username == "FirstOne":
                raise RuntimeError("fail")
            return {"status": "complete", "discovered": 2, "saved": 2,
                    "already_present": 0, "failed": 0, "scanned": 4}
        with patch("userbot_public_video_archive_all.archive_all_channel", fake_archive):
            result = await archive_joined(fake, lambda s: None)
        self.assertEqual(result["channels_failed"], 1)
        self.assertEqual(result["channels_completed"], 1)
        self.assertEqual(result["status"], "partial_failure")
