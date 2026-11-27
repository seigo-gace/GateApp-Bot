#!/usr/bin/env python3
import pathlib, subprocess, sys, unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from repair_registered_normal_topic_buttons import TARGETS,NODE

class RegisteredPinRepairTest(unittest.TestCase):
 def test_exact_two_allowed_existing_messages_only(self):
  self.assertEqual({k:x[4] for k,x in TARGETS.items()},
    {'area273':1604,'category18':1146})
 def test_no_new_public_messages(self):
  self.assertNotIn("sendMessage",NODE)
  self.assertIn("editMessageReplyMarkup",NODE)
 def test_valid_node_js(self):
  code=NODE.replace('__TASK_JSON__','{"action":"identity"}')
  p=subprocess.run(['node','--check','-'],input=code,text=True,capture_output=True)
  self.assertEqual(p.returncode,0,p.stderr[:500])
if __name__=='__main__':unittest.main()
