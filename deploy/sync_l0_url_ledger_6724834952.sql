-- Master #6724834952: L0 = 13 URL inline buttons (no Telegram legal doc message_id gate).
BEGIN;
UPDATE general_guide_links SET label='雑談', destination_url='https://t.me/c/2373696859/4291', enabled=TRUE, verified_at=NOW()
  WHERE chat_id=-1002373696859 AND link_key='freetalk';
UPDATE general_guide_links SET label='雑談', destination_url='https://t.me/c/3770334893/789', enabled=TRUE, verified_at=NOW()
  WHERE chat_id=-1003770334893 AND link_key='freetalk';
UPDATE general_guide_links SET destination_url='https://t.me/c/2373696859/1724', enabled=TRUE, verified_at=NOW()
  WHERE chat_id=-1002373696859 AND link_key='community';
UPDATE general_guide_links SET destination_url='https://t.me/c/3770334893/18', enabled=TRUE, verified_at=NOW()
  WHERE chat_id=-1003770334893 AND link_key='community';
UPDATE general_guide_links SET destination_url='https://t.me/c/3847210571/273', enabled=TRUE, verified_at=NOW()
  WHERE chat_id=-1003847210571 AND link_key='community';
UPDATE general_guide_links SET label='規約', enabled=TRUE, verified_at=NOW() WHERE link_key='terms';
UPDATE general_guide_links SET label='ルール', enabled=TRUE, verified_at=NOW() WHERE link_key='rules';
UPDATE general_guide_links SET label='ガイドライン', enabled=TRUE, verified_at=NOW() WHERE link_key='guideline';
UPDATE general_guide_links SET label='規則', enabled=TRUE, verified_at=NOW() WHERE link_key='privacy';
INSERT INTO general_guide_links (chat_id,link_key,label,destination_url,source,verified_by,verified_at,enabled)
SELECT chat_id,'howto','使い方','https://t.me/GayBBS_bot?start=help','master-6724834952',7880448530,NOW(),TRUE
FROM (VALUES (-1003847210571),(-1002373696859),(-1003770334893)) v(chat_id)
ON CONFLICT (chat_id,link_key) DO UPDATE SET
  label=EXCLUDED.label,destination_url=EXCLUDED.destination_url,
  enabled=TRUE,verified_at=NOW();
COMMIT;
