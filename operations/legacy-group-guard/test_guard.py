"""Offline regression tests: python3 -m unittest discover -s operations/legacy-group-guard -p 'test_*.py'"""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("legacy_guard", Path(__file__).with_name("guard.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def test_exact_group_allowlist(self):
        with patch.dict("os.environ", {
            "GUARD_BOT_TOKEN": "123:placeholder",
            "OLD_CHAT_ID": str(-1003847210571),
        }):
            with self.assertRaisesRegex(ValueError, "Unapproved group ID"):
                guard.run()

    def test_restores_permissions_title_description_and_removes_photo(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.json"
            calls = []
            def fake_api(token, method, values=None, photo=None, timeout=25):
                calls.append((method, values, photo))
                if method == "getChat":
                    if sum(x[0] == "getChat" for x in calls) == 1:
                        return {"type": "supergroup", "id": guard.ALLOWED_OLD_CHAT_ID,
                                "title": "attacked", "description": "attacked",
                                "permissions": {"can_send_messages": True},
                                "photo": {"small_file_unique_id": "old"}}
                    return {"photo": {"small_file_unique_id": "new"}}
                return True
            state = {}
            with patch.object(guard, "api", fake_api):
                guard.restore("token", guard.ALLOWED_OLD_CHAT_ID, "approved", "approved", state, path)
            names = [x[0] for x in calls]
            self.assertIn("setChatTitle", names)
            self.assertIn("setChatDescription", names)
            self.assertIn("setChatPermissions", names)
            self.assertIn("deleteChatPhoto", names)
            self.assertTrue(state["permissions_locked"])

    def test_does_not_modify_healthy_chat(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.json"
            state = {"permissions_locked": True}
            calls = []
            def fake_api(token, method, values=None, photo=None, timeout=25):
                calls.append(method)
                return {"type": "supergroup", "id": guard.ALLOWED_OLD_CHAT_ID,
                        "title": "approved", "description": "approved",
                        "permissions": {}}
            with patch.object(guard, "api", fake_api):
                guard.restore("token", guard.ALLOWED_OLD_CHAT_ID, "approved", "approved", state, path)
            self.assertEqual(calls, ["getChat"])

    def test_joined_user_is_kicked_and_unbanned(self):
        calls = []
        def fake_api(token, method, values=None, photo=None, timeout=25):
            calls.append((method, values))
            if method == "getChatMember":
                return {"status": "member"}
            return True
        with patch.object(guard, "api", fake_api), patch.object(guard.time, "time", return_value=1000):
            result = guard.handle_update("token", guard.ALLOWED_OLD_CHAT_ID, 500,
                {"update_id": 10, "chat_member": {"date": 990,
                    "chat": {"id": guard.ALLOWED_OLD_CHAT_ID},
                    "old_chat_member": {"status": "left"},
                    "new_chat_member": {"status": "member", "user": {"id": 901, "is_bot": False}}
                }})
        self.assertEqual(result, ["KICKED"])
        self.assertEqual([x[0] for x in calls],
                         ["getChatMember", "banChatMember", "unbanChatMember"])
        self.assertEqual(calls[1][1]["user_id"], 901)

    def test_joined_bot_kicked_and_post_deleted(self):
        methods = []
        def fake_api(token, method, values=None, photo=None, timeout=25):
            methods.append(method)
            if method == "getChatMember":
                return {"status": "member"}
            return True
        with patch.object(guard, "api", fake_api), patch.object(guard.time, "time", return_value=1000):
            outcomes = guard.handle_update("token", guard.ALLOWED_OLD_CHAT_ID, 500,
                {"message": {"date": 990, "chat": {"id": guard.ALLOWED_OLD_CHAT_ID},
                             "message_id": 31,
                             "new_chat_members": [{"id": 902, "is_bot": True}]}})
        self.assertEqual(outcomes, ["KICKED", "MESSAGE_DELETED"])
        self.assertEqual(methods, ["getChatMember", "banChatMember",
                                  "unbanChatMember", "deleteMessage"])

    def test_stale_join_backlog_never_kicks_current_member(self):
        with patch.object(guard.time, "time", return_value=1000):
            for date in (None, 500, 0, 1200):
                for kind in ("chat_member", "message"):
                    with self.subTest(date=date, kind=kind), patch.object(guard, "api") as mock_api:
                        if kind == "chat_member":
                            update = {"chat_member": {
                                "date": date, "chat": {"id": guard.ALLOWED_OLD_CHAT_ID},
                                "old_chat_member": {"status": "left"},
                                "new_chat_member": {"status": "member", "user": {"id": 901}}}}
                            expected = []
                        else:
                            update = {"message": {
                                "date": date, "chat": {"id": guard.ALLOWED_OLD_CHAT_ID},
                                "message_id": 42, "new_chat_members": [{"id": 901}]}}
                            expected = ["MESSAGE_DELETED"]
                            mock_api.return_value = True
                        self.assertEqual(guard.handle_update(
                            "token", guard.ALLOWED_OLD_CHAT_ID, 500, update), expected)
                        methods = [call.args[1] for call in mock_api.call_args_list]
                        self.assertNotIn("banChatMember", methods)
                        self.assertNotIn("unbanChatMember", methods)

    def test_expired_message_is_skipped_without_telegram_call(self):
        with patch.object(guard.time, "time", return_value=200000), patch.object(guard, "api") as api_mock:
            actions = guard.handle_update("token", guard.ALLOWED_OLD_CHAT_ID, 500, {
                "message": {"date": 1000, "chat": {"id": guard.ALLOWED_OLD_CHAT_ID},
                            "message_id": 99, "new_chat_members": [{"id": 901}]}})
            self.assertEqual(actions, ["EXPIRED_MESSAGE_SKIPPED"])
            api_mock.assert_not_called()

    def test_bot_identity_constant(self):
        self.assertEqual(guard.EXPECTED_BOT_ID, 8086265383)

    def test_admin_is_not_kicked(self):
        methods = []
        def fake_api(token, method, values=None, photo=None, timeout=25):
            methods.append(method)
            return {"status": "administrator"}
        with patch.object(guard, "api", fake_api):
            result = guard.kick_new_member("token", guard.ALLOWED_OLD_CHAT_ID,
                                           {"id": 999, "is_bot": True}, 500)
        self.assertEqual(result, "ADMIN_PROTECTED_BY_TELEGRAM")
        self.assertEqual(methods, ["getChatMember"])

    def test_guard_itself_not_kicked(self):
        with patch.object(guard, "api") as api_mock:
            result = guard.kick_new_member("token", guard.ALLOWED_OLD_CHAT_ID,
                                           {"id": 500, "is_bot": True}, 500)
        self.assertEqual(result, "GUARD_SELF")
        api_mock.assert_not_called()

    def test_other_chats_are_ignored(self):
        with patch.object(guard, "api") as api_mock:
            actions = guard.handle_update("token", guard.ALLOWED_OLD_CHAT_ID, 500,
                {"message": {"chat": {"id": -1003847210571}, "message_id": 7,
                             "new_chat_members": [{"id": 901, "is_bot": False}]}})
        self.assertEqual(actions, [])
        api_mock.assert_not_called()

    def test_existing_member_changes_not_kicked(self):
        with patch.object(guard, "api") as api_mock:
            actions = guard.handle_update("token", guard.ALLOWED_OLD_CHAT_ID, 500,
                {"chat_member": {"chat": {"id": guard.ALLOWED_OLD_CHAT_ID},
                    "old_chat_member": {"status": "member"},
                    "new_chat_member": {"status": "administrator",
                        "user": {"id": 901, "is_bot": False}}}})
        self.assertEqual(actions, [])
        api_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
