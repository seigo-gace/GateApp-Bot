import unittest
from unittest.mock import patch
from userbot_public_video_archive import archive_channel, archive_all_channel


class ArchiveTests(unittest.IsolatedAsyncioTestCase):
    async def test_downloads_only_selected_joined_public_channel(self):
        calls = []
        progress = []
        async def ipc(action, **kwargs):
            calls.append((action, kwargs))
            if action == "list_joined_public_channels":
                return {"status": "PASS", "channels": [
                    {"id": 42, "username": "examplePublic", "isPublic": True},
                    {"id": 99, "username": "privateChannel", "isPublic": False},
                ]}
            if action == "list_channel_videos":
                return {"status": "PASS", "videos": [{"messageId": 3}, {"messageId": 2}]}
            return {"status": "PASS", "completed": True, "storageKey": "/mnt/g/GserverStorage/a.mp4",
                    "alreadyPresent": kwargs["message_id"] == 2}
        result = await archive_channel(ipc, "examplePublic", 30, lambda state: progress.append(dict(state)))
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["saved"], 1)
        self.assertEqual(result["already_present"], 1)
        self.assertEqual(result["completed"], [3, 2])
        self.assertEqual([x[1]["channel_id"] for x in calls if "channel_id" in x[1]], [42, 42, 42])
        self.assertGreaterEqual(len(progress), 3)


    async def test_all_pages_skip_empty_video_page(self):
        called = []
        snapshots = []
        async def ipc(action, **kwargs):
            called.append((action, kwargs))
            if action == "list_joined_public_channels":
                return {"status": "PASS", "channels": [
                    {"id": 42, "username": "publicArchive", "isPublic": True}]}
            if action == "list_channel_video_page":
                cursor = kwargs.get("before_message_id")
                if cursor is None:
                    return {"status": "PASS", "videos": [{"messageId": 300}],
                            "scanned": 500, "nextBeforeMessageId": 200}
                if cursor == 200:
                    return {"status": "PASS", "videos": [],
                            "scanned": 500, "nextBeforeMessageId": 100}
                return {"status": "PASS", "videos": [{"messageId": 20}],
                        "scanned": 50, "nextBeforeMessageId": None}
            return {"status": "PASS", "completed": True,
                    "storageKey": "/mnt/g/GserverStorage/video.mp4",
                    "alreadyPresent": kwargs["message_id"] == 20}
        result = await archive_all_channel(ipc, "publicArchive",
                                           lambda st: snapshots.append(dict(st)))
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["discovered"], 2)
        self.assertEqual(result["saved"], 1)
        self.assertEqual(result["already_present"], 1)
        self.assertEqual(result["scanned"], 1050)
        pages = [args.get("before_message_id") for action,args in called
                 if action == "list_channel_video_page"]
        self.assertEqual(pages, [None, 200, 100])
        self.assertTrue(snapshots)

    async def test_refuses_channel_not_joined(self):
        async def ipc(action, **kwargs):
            return {"status": "PASS", "channels": []}
        with self.assertRaisesRegex(RuntimeError, "TARGET_JOINED_PUBLIC_CHANNEL_NOT_FOUND"):
            await archive_channel(ipc, "absentName", 20, lambda _state: None)

    async def test_invalid_limit_rejected_before_session_access(self):
        async def ipc(*args, **kwargs):
            self.fail("No IPC should be called")
        with self.assertRaises(ValueError):
            await archive_channel(ipc, "examplePublic", 51, lambda _state: None)


if __name__ == "__main__":
    unittest.main()
