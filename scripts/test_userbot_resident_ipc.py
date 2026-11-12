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


if __name__ == "__main__":
    unittest.main()
