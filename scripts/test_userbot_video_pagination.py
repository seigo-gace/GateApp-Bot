import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from userbot_public_video_actions import channel_video_page


class PublicVideoPagingTests(unittest.IsolatedAsyncioTestCase):
    def fake_client(self, messages):
        channel = SimpleNamespace(id=42, username="publictest", title="Public", megagroup=False)
        class Client:
            async def iter_dialogs(self):
                yield SimpleNamespace(entity=channel, is_channel=True)

            async def iter_messages(self, entity, limit, offset_id=0):
                count = 0
                for msg in messages:
                    if not offset_id or msg.id < offset_id:
                        yield msg
                        count += 1
                        if count >= limit:
                            break
        return Client()

    async def test_cursor_advances_even_without_video(self):
        msgs = [SimpleNamespace(id=i, video=None, date=None, raw_text="")
                for i in range(600, 0, -1)]
        client = self.fake_client(msgs)
        a = await channel_video_page(client, 42)
        self.assertEqual(a["videos"], [])
        self.assertEqual(a["scanned"], 500)
        self.assertEqual(a["nextBeforeMessageId"], 101)
        b = await channel_video_page(client, 42, a["nextBeforeMessageId"])
        self.assertIsNone(b["nextBeforeMessageId"])
        self.assertEqual(b["scanned"], 100)

    async def test_50_video_per_page_not_global_limit(self):
        msgs = [SimpleNamespace(id=i, video=object(), date=datetime.now(timezone.utc),
                                raw_text="caption") for i in range(110, 0, -1)]
        client = self.fake_client(msgs)
        a = await channel_video_page(client, 42)
        b = await channel_video_page(client, 42, a["nextBeforeMessageId"])
        c = await channel_video_page(client, 42, b["nextBeforeMessageId"])
        self.assertEqual([len(x["videos"]) for x in (a,b,c)], [50,50,10])
        self.assertIsNone(c["nextBeforeMessageId"])

    async def test_invalid_cursor_rejected(self):
        with self.assertRaises(ValueError):
            await channel_video_page(self.fake_client([]), 42, before_message_id=-1)


if __name__ == "__main__":
    unittest.main()
