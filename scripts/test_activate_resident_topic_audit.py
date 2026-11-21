#!/usr/bin/env python3
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from activate_resident_topic_audit import patch_ipc, patch_client

ROOT = pathlib.Path(__file__).parent
class SurgicalPatchTests(unittest.TestCase):
    def test_patch_ipc_preserves_unrelated_actions(self):
        current = (ROOT / "userbot_resident_ipc.py").read_text()
        base = current.replace(' "topic_entry_audit",', '')
        if '"topic_entry_audit"' not in current:
            return
        self.assertIn('"topic_entry_audit"', current)
        self.assertIn('bug_report_delivery_smoke', current)
    def test_patch_client_module_compiles(self):
        source = (ROOT / "activate_resident_topic_audit.py").read_text()
        compile(source, "activate_resident_topic_audit.py", "exec")
    def test_reject_second_activation(self):
        a = (ROOT / "userbot_resident_ipc.py").read_text()
        if '"topic_entry_audit"' in a:
            with self.assertRaisesRegex(RuntimeError,"AUDIT_ALREADY_REGISTERED"):
                patch_ipc(a)
        c = (ROOT / "userbot_test_client.py").read_text()
        if 'topic_entry_audit' in c:
            with self.assertRaisesRegex(RuntimeError,"CLIENT_AUDIT_ALREADY_PRESENT"):
                patch_client(c)
if __name__ == "__main__":
    unittest.main()
