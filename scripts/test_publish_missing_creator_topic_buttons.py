#!/usr/bin/env python3
import pathlib
import subprocess
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from publish_missing_creator_topic_buttons import check_missing,TARGETS,NODE_SCRIPT

class CreatorButtonSafetyTests(unittest.TestCase):
    def test_exact_targets(self):
        self.assertEqual(TARGETS,{1695:"video",4640:"sticker"})
    def test_existing_post_blocks_new_message(self):
        rows={1695:{"title":"稼げる有料動画投稿","post_button":"PRESENT",
                    "history_inspected":7,"pin_state":"ABSENT_FROM_PINS"}}
        with self.assertRaisesRegex(RuntimeError,"CREATOR_EXISTING_OR_UNKNOWN_BUTTON_PROTECTED"):
            check_missing(rows,1695)
    def test_complete_absence_is_eligible(self):
        rows={4640:{"title":"ステッカーの公開と販売","post_button":"ABSENT",
                    "history_inspected":7,"pin_state":"ABSENT_FROM_PINS"}}
        check_missing(rows,4640)
    def test_inconclusive_blocked(self):
        rows={1695:{"title":"稼げる有料動画投稿","post_button":"INCONCLUSIVE_HISTORY_LIMIT",
                    "history_inspected":150,"pin_state":"ABSENT_FROM_PINS"}}
        with self.assertRaises(RuntimeError):
            check_missing(rows,1695)
    def test_embedded_node_sender_parses_without_secrets(self):
        p=subprocess.run(["node","--check","-"],input=NODE_SCRIPT,text=True,
                         capture_output=True,check=False)
        self.assertEqual(p.returncode,0,p.stderr[:500])

if __name__=="__main__":unittest.main()
