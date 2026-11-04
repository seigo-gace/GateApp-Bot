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
            "CANONICAL_TITLE": "x",
            "CANONICAL_DESCRIPTION": "x",
            "CANONICAL_PHOTO_FILE": "/does/not/exist",
        }):
            with self.assertRaisesRegex(ValueError, "Unapproved group ID"):
                guard.run()

    def test_restores_permissions_title_description_and_photo(self):
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
                guard.restore("token", guard.ALLOWED_OLD_CHAT_ID, "approved", "approved", b"photo", state, path)
            names = [x[0] for x in calls]
            self.assertIn("setChatTitle", names)
            self.assertIn("setChatDescription", names)
            self.assertIn("setChatPermissions", names)
            self.assertIn("setChatPhoto", names)
            self.assertTrue(state["permissions_locked"])
            self.assertEqual(state["canonical_photo_id"], "new")

    def test_does_not_modify_healthy_chat(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.json"
            state = {"permissions_locked": True, "canonical_photo_id": "ok",
                     "canonical_photo_sha256": __import__("hashlib").sha256(b"photo").hexdigest()}
            calls = []
            def fake_api(token, method, values=None, photo=None, timeout=25):
                calls.append(method)
                return {"type": "supergroup", "id": guard.ALLOWED_OLD_CHAT_ID,
                        "title": "approved", "description": "approved",
                        "permissions": {}, "photo": {"small_file_unique_id": "ok"}}
            with patch.object(guard, "api", fake_api):
                guard.restore("token", guard.ALLOWED_OLD_CHAT_ID, "approved", "approved", b"photo", state, path)
            self.assertEqual(calls, ["getChat"])


if __name__ == "__main__":
    unittest.main()
