import unittest
from userbot_public_video_collect_once import collect_once


class CollectBatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_channels_only_and_repeated_downloads(self):
        calls = []
        async def ipc(action, **kwargs):
            calls.append((action, kwargs))
            if action == "list_joined_public_channels":
                return {"status": "PASS", "channels": [
                    {"id": 11, "username": "publicA", "isPublic": True},
                    {"id": 12, "username": "privateB", "isPublic": False},
                ]}
            if action == "list_channel_videos":
                return {"status": "PASS", "videos": [{"messageId": 4}, {"messageId": 3}]}
            return {"status": "PASS", "storageKey": "/mnt/g/GserverStorage/video.mp4",
                    "alreadyPresent": kwargs["message_id"] == 3}
        counts = await collect_once(ipc, max_per_channel=5)
        self.assertEqual(counts, {
            "channels": 1, "videos_found": 2, "downloaded": 1,
            "already_present": 1, "failed": 0,
        })
        self.assertEqual(len([c for c in calls if c[0] == "download_channel_video"]), 2)

    async def test_channel_filter(self):
        async def ipc(action, **kwargs):
            if action == "list_joined_public_channels":
                return {"status": "PASS", "channels": [
                    {"id": 11, "username": "publicA", "isPublic": True},
                    {"id": 12, "username": "publicB", "isPublic": True},
                ]}
            return {"status": "PASS", "videos": []}
        counts = await collect_once(ipc, channel_username="@publicB")
        self.assertEqual(counts["channels"], 1)

    async def test_invalid_limit_is_rejected_before_ipc(self):
        async def unused(*args, **kwargs):
            self.fail("IPC should not be called")
        with self.assertRaises(ValueError):
            await collect_once(unused, max_per_channel=0)


if __name__ == "__main__":
    unittest.main()
