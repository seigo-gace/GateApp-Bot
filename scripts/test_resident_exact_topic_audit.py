#!/usr/bin/env python3
import asyncio
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
sys.path.insert(0,str(pathlib.Path(__file__).parent))
import userbot_topic_entry_audit as a

class ExactTopicAuditTests(unittest.TestCase):
 def test_exact_id_selects_topic_regardless_of_list_position(self):
  class Client:
   async def get_entity(self,name):
    return SimpleNamespace(bot=True,id=101)
  topics=[SimpleNamespace(id=995,title='東海ブロック'),
          SimpleNamespace(id=1379,title='総合案内')]
  pin={'state':'ABSENT_FROM_PINS','message_ids':[],'button_types':[]}
  history={'state':'ABSENT','message_ids':[],'button_types':[],'inspected':2}
  with patch.object(a,'existing_chat',new_callable=AsyncMock) as ent, \
       patch.object(a,'list_topics',new_callable=AsyncMock,return_value=topics), \
       patch.object(a,'pinned_post_entry',new_callable=AsyncMock,return_value=pin), \
       patch.object(a,'recent_topic_buttons',new_callable=AsyncMock,return_value=history):
   ent.return_value=object()
   r=asyncio.run(a.audit(Client(),a.AREA_CHAT,-995))
  self.assertEqual(r['page'],-995)
  self.assertEqual(len(r['rows']),1)
  self.assertEqual(r['rows'][0]['topic_id'],995)
  self.assertFalse(r['has_more'])
 def test_nonexistent_target_fails_closed(self):
  class Client:
   async def get_entity(self,name):
    return SimpleNamespace(bot=True,id=101)
  with patch.object(a,'existing_chat',new_callable=AsyncMock), \
       patch.object(a,'list_topics',new_callable=AsyncMock,return_value=[]):
   with self.assertRaisesRegex(ValueError,'TOPIC_AUDIT_TOPIC_NOT_FOUND'):
    asyncio.run(a.audit(Client(),a.AREA_CHAT,-995))
if __name__=='__main__':unittest.main()
