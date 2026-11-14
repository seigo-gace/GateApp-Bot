import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import userbot_public_video_actions as archive


class Stream:
    def __init__(self, chunks):
        self.chunks = iter(chunks)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.chunks)
        except StopIteration:
            raise StopAsyncIteration

    async def close(self):
        self.closed = True


class Client:
    def __init__(self, data):
        self.data = data
        self.calls = []
        self.entity = SimpleNamespace(id=42, username="some_public", megagroup=False)
        self.message = SimpleNamespace(id=8, video=SimpleNamespace(size=len(data)),
                                       file=SimpleNamespace(ext=".mp4"), media="media")

    async def iter_dialogs(self):
        yield SimpleNamespace(is_channel=True, entity=self.entity)

    async def get_messages(self, _entity, ids):
        return self.message if ids == 8 else None

    def iter_download(self, _media, *, offset, limit=None, chunk_size=None,
                      request_size=None, file_size=None):
        self.calls.append(offset)
        rest = self.data[offset:]
        if limit is not None:
            return Stream([rest[:chunk_size]] if rest else [])
        return Stream([rest[i:i+chunk_size] for i in range(0, len(rest), chunk_size)])


class ResumeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Path(self.tmp.name)
        self.root = self.store / "public_channel_videos"
        self.p1 = patch.object(archive, "STORAGE_ROOT", self.store)
        self.p2 = patch.object(archive, "VIDEO_ROOT", self.root)
        self.p3 = patch.object(archive, "CHUNK_BYTES", 4)
        for p in [self.p1, self.p2, self.p3]:
            p.start()
            self.addCleanup(p.stop)
        (self.root / "42").mkdir(parents=True)

    async def test_resume_keeps_partial_bytes(self):
        partial = self.root / "42" / "8.partial"
        partial.write_bytes(b"abcdefgh")
        client = Client(b"abcdefghijk")
        result = await archive.download_video(client, 42, 8)
        self.assertTrue(result["verifiedSize"])
        self.assertEqual(result["sizeBytes"], 11)
        self.assertEqual(client.calls, [0, 8])
        self.assertFalse(partial.exists())
        self.assertEqual((self.root / "42" / "8.mp4").read_bytes(), b"abcdefghijk")

    async def test_bounded_step_then_resume_to_completion(self):
        client = Client(b"abcdefghijk")
        first = await archive.download_video(client, 42, 8, max_chunks=1)
        self.assertEqual(first, {"completed": False, "progressBytes": 4, "sizeBytes": 11})
        self.assertTrue((self.root / "42" / "8.partial").exists())
        second = await archive.download_video(client, 42, 8, max_chunks=1)
        self.assertEqual(second["progressBytes"], 8)
        third = await archive.download_video(client, 42, 8, max_chunks=1)
        self.assertTrue(third["completed"])
        self.assertEqual((self.root / "42" / "8.mp4").read_bytes(), b"abcdefghijk")

    async def test_prefix_mismatch_preserves_existing_partial(self):
        partial = self.root / "42" / "8.partial"
        partial.write_bytes(b"wxyz")
        client = Client(b"abcdefghijk")
        with self.assertRaisesRegex(RuntimeError, "PARTIAL_PREFIX_MISMATCH"):
            await archive.download_video(client, 42, 8)
        self.assertEqual(partial.read_bytes(), b"wxyz")
        self.assertFalse((self.root / "42" / "8.mp4").exists())

    async def test_complete_partial_promoted_only_after_prefix_check(self):
        partial = self.root / "42" / "8.partial"
        partial.write_bytes(b"abcdefghijk")
        client = Client(b"abcdefghijk")
        await archive.download_video(client, 42, 8)
        self.assertEqual(client.calls, [0])
        self.assertTrue((self.root / "42" / "8.mp4").exists())

    async def test_existing_complete_reused_without_download(self):
        finished = self.root / "42" / "8.mp4"
        finished.write_bytes(b"abcdefghijk")
        client = Client(b"abcdefghijk")
        result = await archive.download_video(client, 42, 8)
        self.assertTrue(result["alreadyPresent"])
        self.assertEqual(client.calls, [])

    async def test_oversized_partial_preserved(self):
        partial = self.root / "42" / "8.partial"
        partial.write_bytes(b"abcdefghijktoo_large")
        with self.assertRaisesRegex(RuntimeError, "PARTIAL_LARGER_THAN_SOURCE"):
            await archive.download_video(Client(b"abcdefghijk"), 42, 8)
        self.assertTrue(partial.exists())

    async def test_short_remote_download_is_not_marked_complete(self):
        client = Client(b"abcdefghijk")
        client.message.video.size = 12
        with self.assertRaisesRegex(RuntimeError, "DOWNLOAD_INCOMPLETE"):
            await archive.download_video(client, 42, 8)
        self.assertEqual((self.root / "42" / "8.partial").read_bytes(), b"abcdefghijk")


if __name__ == "__main__":
    unittest.main()
