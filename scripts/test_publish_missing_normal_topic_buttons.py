#!/usr/bin/env python3
import pathlib
import subprocess
import sys
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from publish_missing_normal_topic_buttons import TARGETS,CHATS,BOT_NODE,assert_absent,resolve_topic
from unittest.mock import patch

class NormalPostingProtectionTests(unittest.TestCase):
 def test_exact_scope(self):
  self.assertEqual(len(CHATS),3)
  self.assertEqual(sum(len(p) for group in TARGETS.values() for p in group.values()),17)
  for group, pages in TARGETS.items():
   for ids in pages.values():
    self.assertFalse({1,48,1613,210,1695,4640,1000,273,1724,4291,18}&set(ids))
 def test_protect_published(self):
  with self.assertRaisesRegex(RuntimeError,'EXISTING_BUTTON'):
   assert_absent({'topic_id':995,'title':'東海ブロック','post_button':'PRESENT',
                  'pin_state':'ABSENT_FROM_PINS','history_inspected':2},995)
 def test_unknown_history_fails_closed(self):
  with self.assertRaises(RuntimeError):
   assert_absent({'topic_id':1,'title':'運営からのお知らせ','post_button':'INCONCLUSIVE_HISTORY_LIMIT',
                  'pin_state':'ABSENT_FROM_PINS','history_inspected':150},1)
 def test_verified_absence_passes(self):
  self.assertEqual(assert_absent({'topic_id':995,'title':'東海ブロック','post_button':'ABSENT',
                  'pin_state':'ABSENT_FROM_PINS','history_inspected':2},995),'東海ブロック')
 def test_topic_moving_between_pages_still_found_by_id(self):
  target={'topic_id':995,'title':'東海ブロック','post_button':'ABSENT',
          'pin_state':'ABSENT_FROM_PINS','history_inspected':2}
  with patch('publish_missing_normal_topic_buttons.live_rows',
             side_effect=lambda group,page:{995:target} if page==8 else {}):
   self.assertEqual(resolve_topic('area',7,995),target)
 def test_existing_bot_node_sender_valid(self):
  p=subprocess.run(['node','--check','-'],input=BOT_NODE.replace('__TASK_JSON__','{"action":"identity"}'),
                   text=True,capture_output=True,check=False)
  self.assertEqual(p.returncode,0,p.stderr[:400])
if __name__=='__main__':unittest.main()
