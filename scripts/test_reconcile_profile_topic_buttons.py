#!/usr/bin/env python3
import pathlib,subprocess,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from reconcile_profile_topic_buttons import TARGETS,NODE,verify

class ProfileTopicTests(unittest.TestCase):
 def test_three_exact_profiles_and_existing_ids(self):
  self.assertEqual([(x[1],len(x[3])) for x in TARGETS],[(1613,3),(210,3),(48,0)])
 def test_wrong_existing_buttons_refused(self):
  with self.assertRaisesRegex(RuntimeError,"PROFILE_ORIGINAL_BUTTONS_CHANGED"):
   verify(1613,(4623,4609,4595),{"title":"みんなのプロフ","post_button":"ABSENT","button_types":[]})
 def test_no_duplicate_profile_post(self):
  with self.assertRaisesRegex(RuntimeError,"PROFILE_ALREADY_PRESENT_OR_UNCERTAIN"):
   verify(48,(),{"title":"みんなのプロフ","post_button":"PRESENT","button_types":["profile"]})
 def test_embedded_node_code_syntax(self):
  task='{"action":"identity"}'
  script=NODE.replace("__TASK_JSON__",task)
  p=subprocess.run(["node","--check","-"],input=script,text=True,capture_output=True)
  self.assertEqual(p.returncode,0,p.stderr[:500])
if __name__=="__main__":unittest.main()
