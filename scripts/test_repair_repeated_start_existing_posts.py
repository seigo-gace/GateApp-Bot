#!/usr/bin/env python3
import pathlib,subprocess,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from repair_repeated_start_existing_posts import TARGETS,CHAT,NODE
class InPlaceStartlessRepairTests(unittest.TestCase):
 def test_exact_only_ten_messages(self):
  self.assertEqual(TARGETS,{102:1494,104:1496,116:1498,1000:1500,
    81:1502,92:1504,103:1506,50:1526,51:1529,52:1532})
  self.assertEqual(CHAT,-1003847210571)
 def test_only_markup_edit_no_public_repost(self):
  self.assertIn("editMessageReplyMarkup",NODE)
  self.assertNotIn("sendMessage",NODE)
  self.assertNotIn("deleteMessage",NODE)
 def test_javascript_syntax(self):
  p=subprocess.run(["node","--check","-"],
    input=NODE.replace("__TASK__",'{"action":"identity"}'),
    text=True,capture_output=True)
  self.assertEqual(p.returncode,0,p.stderr[:450])
if __name__=="__main__":unittest.main()
