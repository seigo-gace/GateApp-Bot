#!/usr/bin/env python3
"""No Telegram network, secrets, session or worker lifecycle used in these tests."""
import asyncio
import unittest
from types import SimpleNamespace

from userbot_resident_ipc import EXPECTED_MENU, process_request


class MockClient:
    def __init__(self, authorized=True, menu=None):
        self.authorized = authorized
        self.menu = menu if menu is not None else EXPECTED_MENU
        self.sent = []

    async def is_user_authorized(self):
        return self.authorized

    def is_connected(self):
        return True

    async def get_entity(self, name):
        assert name == "GayBBS_bot"
        return SimpleNamespace(bot=True)

    async def get_messages(self, bot, limit):
        if not self.sent:
            return [SimpleNamespace(id=10)]
        buttons = [[SimpleNamespace(text=x) for x in row] for row in self.menu]
        return [SimpleNamespace(id=11, out=False, buttons=buttons)]

    async def send_message(self, bot, message):
        self.sent.append(message)


class ResidentSafetyTests(unittest.TestCase):
    def test_health_only_reads_authorization(self):
        c = MockClient()
        out = asyncio.run(process_request(c, {"request_id": "health-1", "action": "health"}))
        self.assertEqual(out["status"], "PASS")
        self.assertEqual(c.sent, [])

    def test_live_bot_menu_allowlisted(self):
        c = MockClient()
        out = asyncio.run(process_request(c, {"request_id": "menu-1", "action": "bot_start_menu"}))
        self.assertEqual(out["status"], "PASS")
        self.assertEqual(out["row_sizes"], [3, 2, 2, 3])
        self.assertEqual(c.sent, ["/start"])

    def test_wrong_menu_not_pass(self):
        c = MockClient(menu=[["wrong"]])
        out = asyncio.run(process_request(c, {"request_id": "menu-2", "action": "bot_start_menu"}))
        self.assertEqual(out["status"], "FAIL")

    def test_no_arbitrary_actions_or_args(self):
        c = MockClient()
        for req in (
            {"request_id": "a", "action": "logout"},
            {"request_id": "a", "action": "stop_service"},
            {"request_id": "a", "action": "python", "script": "print(1)"},
            {"request_id": "../", "action": "health"},
            {"request_id": "a", "action": []},
        ):
            with self.assertRaises((ValueError, TypeError)):
                asyncio.run(process_request(c, req))
        self.assertEqual(c.sent, [])

    def test_expired_session_refused_without_login(self):
        c = MockClient(authorized=False)
        with self.assertRaises(RuntimeError):
            asyncio.run(process_request(c, {"request_id": "x", "action": "health"}))
        self.assertEqual(c.sent, [])


class RoomMessage:
    id = 11
    out = False

    def __init__(self, client):
        self.client = client

    @property
    def raw_text(self):
        if self.client.state == "guide":
            return "募集+Room 1行目タイトル 2行目以降説明 3行目ニックネーム"
        if self.client.state == "preview":
            return "募集+Room E2E動作検証（未投稿）"
        return "募集+Room" if self.client.state == "method" else "投稿メニュー"

    @property
    def buttons(self):
        labels = {
            "menu": EXPECTED_MENU,
            "method": [["Room作成"], ["キャンセル"]],
            "guide": [["キャンセル"]],
            "preview": [["キャンセル"], ["投稿する"]],
        }.get(self.client.state, [])
        return [[SimpleNamespace(text=label) for label in row] for row in labels]

    async def click(self, text):
        transitions = {
            ("menu", "募集+Room"): "method",
            ("method", "Room作成"): "guide",
            ("guide", "キャンセル"): "menu",
            ("method", "キャンセル"): "menu",
            ("preview", "キャンセル"): "menu",
        }
        self.client.state = transitions[(self.client.state, text)]


class RoomClient:
    """Private DM fake; no network, no session and no public publish capability."""
    def __init__(self, input_deleted=True):
        self.state = "initial"
        self.input_deleted = input_deleted
        self.sent = []
        self.bot = SimpleNamespace(bot=True)
        self.message = RoomMessage(self)

    async def is_user_authorized(self):
        return True

    async def get_entity(self, name):
        assert name == "GayBBS_bot"
        return self.bot

    async def get_messages(self, bot, limit=None, ids=None):
        assert bot is self.bot
        if ids == 99:
            return None if self.input_deleted else SimpleNamespace(id=99)
        if ids is not None:
            return self.message if ids == 11 else None
        return [SimpleNamespace(id=10)] if self.state == "initial" else [self.message]

    async def send_message(self, bot, message):
        assert bot is self.bot
        self.sent.append(message)
        if message == "/start":
            self.state = "menu"
            return SimpleNamespace(id=12)
        if self.state != "guide":
            raise AssertionError("PRIVATE_ROOM_TEST_SENT_AT_UNEXPECTED_STEP")
        self.state = "preview"
        return SimpleNamespace(id=99)


class ResidentRoomSafetyTests(unittest.TestCase):
    def test_private_room_wizard_returns_to_menu_without_publishing(self):
        client = RoomClient()
        result = asyncio.run(process_request(
            client, {"request_id": "room-private-1", "action": "room_private_smoke"}))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["action"], "room_private_smoke")
        self.assertEqual(result["steps"], [
            "start_menu", "room_method", "room_input_preview",
            "room_input_deleted", "cancel_menu_restored",
        ])
        self.assertEqual(client.state, "menu")
        self.assertEqual(len(client.sent), 2)
        self.assertEqual(client.sent[0], "/start")
        self.assertIn("未投稿", client.sent[1])

    def test_missing_new_input_deletion_fails_and_still_cancels(self):
        client = RoomClient(input_deleted=False)
        with self.assertRaisesRegex(RuntimeError, "ROOM_INPUT_MESSAGE_NOT_DELETED"):
            asyncio.run(process_request(
                client, {"request_id": "room-private-2", "action": "room_private_smoke"}))
        self.assertEqual(client.state, "menu")
        self.assertEqual(len(client.sent), 2)



if __name__ == "__main__":
    unittest.main()
