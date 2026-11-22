#!/usr/bin/env python3
import pathlib,subprocess,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
import recover_denied_general_topic_button as g
import publish_missing_normal_topic_buttons as n
class GeneralForumRecoveryTests(unittest.TestCase):
 def test_all_announcement_targets_disabled(self):
  self.assertEqual(g.TARGETS,{})
 def test_general_sender_omits_thread_id(self):
  self.assertIn("task.thread_id===1?{}:",n.BOT_NODE)
  self.assertIn("(task.thread_id!==1&&",n.BOT_NODE)
 def test_general_script_compiles(self):
  self.assertTrue(pathlib.Path(g.__file__).is_file())
 def test_normal_source_still_excludes_general(self):
  self.assertTrue(all(1 not in pages for pages in (p for group in n.TARGETS.values() for p in group.values())))
if __name__=="__main__":unittest.main()
