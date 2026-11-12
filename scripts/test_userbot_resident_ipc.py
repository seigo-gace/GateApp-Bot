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



class PublicRoomReadClient:
    """Simulated existing Telegram message; no network or sending methods."""
    def __init__(self, marker="finished", has_join=False, owner_id=42, visible=True):
        self.marker = marker
        self.has_join = has_join
        self.owner_id = owner_id
        self.visible = visible
        self.requests = []

    async def is_user_authorized(self):
        return True

    async def get_entity(self, name):
        assert name == "GayBBS_bot"
        return SimpleNamespace(bot=True, id=42)

    async def get_messages(self, chat_id, ids=None):
        assert chat_id == -1003847210571
        assert ids == 123
        self.requests.append((chat_id, ids))
        if not self.visible:
            return None
        states = {"finished": "✅ 終了", "live": "🔴 LIVE中",
                  "scheduled": "📅 予告中", "unknown": "状態不明"}
        return SimpleNamespace(
            id=123, sender_id=self.owner_id,
            raw_text="🎬 ROOM\n状態：" + states[self.marker],
            buttons=[[SimpleNamespace(text="参加する")]] if self.has_join else [],
        )


class RoomPublicReadbackTests(unittest.TestCase):
    def test_existing_finished_public_card_reads_without_sending(self):
        client = PublicRoomReadClient()
        result = asyncio.run(process_request(client, {
            "request_id": "public-read-1", "action": "room_public_readback",
            "chat_id": -1003847210571, "message_id": 123}))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["marker"], "finished")
        self.assertEqual(result["has_join_button"], False)
        self.assertNotIn("chat_id", result)
        self.assertNotIn("message_id", result)
        self.assertEqual(client.requests, [(-1003847210571, 123)])

    def test_live_card_with_join_button_is_detected(self):
        result = asyncio.run(process_request(PublicRoomReadClient("live", True), {
            "request_id": "public-read-2", "action": "room_public_readback",
            "chat_id": -1003847210571, "message_id": 123}))
        self.assertEqual((result["marker"], result["has_join_button"]), ("live", True))

    def test_target_validation_precedes_any_telegram_group_read(self):
        client = PublicRoomReadClient()
        for invalid in (
            {"chat_id": -1001, "message_id": 123},
            {"chat_id": -1003847210571, "message_id": 0},
            {"chat_id": -1003847210571, "message_id": True},
            {"chat_id": -1003847210571, "message_id": "123"},
        ):
            with self.assertRaises(ValueError):
                asyncio.run(process_request(client, {
                    "request_id": "public-negative", "action": "room_public_readback",
                    **invalid,
                }))
        self.assertEqual(client.requests, [])

    def test_message_owner_must_be_real_target_bot(self):
        with self.assertRaisesRegex(RuntimeError, "ROOM_PUBLIC_MESSAGE_OWNER_MISMATCH"):
            asyncio.run(process_request(PublicRoomReadClient(owner_id=99), {
                "request_id": "owner-check", "action": "room_public_readback",
                "chat_id": -1003847210571, "message_id": 123}))

    def test_missing_message_is_explicit_failure(self):
        with self.assertRaisesRegex(RuntimeError, "ROOM_PUBLIC_MESSAGE_NOT_VISIBLE"):
            asyncio.run(process_request(PublicRoomReadClient(visible=False), {
                "request_id": "visible-check", "action": "room_public_readback",
                "chat_id": -1003847210571, "message_id": 123}))



class DialogResolvedClient(PublicRoomReadClient):
    """Only existing joined dialogs can provide missing Telegram input entities."""
    def __init__(self, joined=True):
        super().__init__()
        self.joined = joined
        self.entity = SimpleNamespace(id=3847210571)

    async def get_dialogs(self, limit=None):
        self.requested_dialog_limit = limit
        if not self.joined:
            return []
        return [SimpleNamespace(id=-1003847210571, entity=self.entity)]

    async def get_messages(self, chat, ids=None):
        if type(chat) is int:
            raise ValueError("Telethon private entity details must be redacted")
        assert chat is self.entity
        return await super().get_messages(-1003847210571, ids=ids)


class ResidentDialogResolutionTests(unittest.TestCase):
    def test_cold_cache_reads_only_joined_group(self):
        client = DialogResolvedClient()
        result = asyncio.run(process_request(client, {
            "request_id": "joined-read", "action": "room_public_readback",
            "chat_id": -1003847210571, "message_id": 123}))
        self.assertEqual(result["marker"], "finished")
        self.assertEqual(client.requested_dialog_limit, 500)

    def test_not_joined_fails_without_joining(self):
        client = DialogResolvedClient(joined=False)
        with self.assertRaisesRegex(RuntimeError, "ROOM_READ_GROUP_NOT_IN_EXISTING_DIALOGS"):
            asyncio.run(process_request(client, {
                "request_id": "not-joined", "action": "room_public_readback",
                "chat_id": -1003847210571, "message_id": 123}))
        self.assertEqual(client.requests, [])


if __name__ == "__main__":
    unittest.main()
