#!/usr/bin/env python3
import json,pathlib,subprocess,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from publish_missing_normal_topic_entries import NODE,FORUMS,escape
from verify_missing_normal_topic_entries import classify
class NormalButtonSafetyTests(unittest.TestCase):
 def test_scope_excludes_all_announcement_topics(self):
  self.assertEqual([(g,t) for g,(c,items) in FORUMS.items() for t,v in items],
    [("area",105)])
  self.assertEqual(FORUMS['video'][1],[])
  self.assertEqual(FORUMS['category'][1],[])
 def test_announcement_title_excluded(self):
  self.assertEqual(classify({"title":"運営からのお知らせ","post_button":"ABSENT",
     "pin_state":"ABSENT_FROM_PINS","history_inspected":5},"お知らせ"),
   "OUT_OF_SCOPE_OR_CHANGED_TITLE")
 def test_existing_buttons_protected(self):
  self.assertEqual(classify({"title":"国際交流トーク","post_button":"PRESENT",
     "pin_state":"ABSENT_FROM_PINS","history_inspected":7},"国際交流"),
   "EXISTING_BUTTON_PROTECTED")
 def test_history_limit_protected(self):
  self.assertEqual(classify({"title":"運営からのお知らせ","post_button":"INCONCLUSIVE_HISTORY_LIMIT",
     "pin_state":"ABSENT_FROM_PINS","history_inspected":150},"お知らせ"),
   "HISTORY_INCONCLUSIVE")
 def test_excluded_topic_never_allowed(self):
  self.assertEqual(classify({"title":"総合案内","post_button":"ABSENT",
     "pin_state":"ABSENT_FROM_PINS","history_inspected":5},"総合案内"),
   "OUT_OF_SCOPE_OR_CHANGED_TITLE")
 def test_embed_sender_syntax(self):
  src=NODE.replace("__TASK_JSON__",json.dumps({"mode":"identity"}))
  p=subprocess.run(["node","--check","-"],input=src,text=True,capture_output=True)
  self.assertEqual(p.returncode,0,p.stderr[:300])
 def test_sql_title_escaping(self):
  self.assertEqual(escape("a'b"),"a''b")
if __name__=="__main__":unittest.main()
