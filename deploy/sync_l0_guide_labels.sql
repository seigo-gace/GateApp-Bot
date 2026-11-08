-- Master 2026-11-08: L0 general guide 13-button labels (3/3/3/4).
-- Topic boards national/category/video are sourced from topic_board_posts, not here.
BEGIN;
UPDATE general_guide_links SET label='雑談', verified_at=NOW()
  WHERE link_key='freetalk' AND label<> '雑談';
UPDATE general_guide_links SET label='リンク', verified_at=NOW()
  WHERE link_key='community' AND label<> 'リンク';
UPDATE general_guide_links SET enabled=FALSE, verified_at=NOW()
  WHERE link_key IN ('national','category','video');
-- 「規則」は「ルール」(group-rules) と別。承認済み privacy 正本 URL を L0 表示ラベルのみ規則へ。
UPDATE general_guide_links SET label='規則', enabled=TRUE, verified_at=NOW()
  WHERE link_key='privacy' AND destination_url LIKE '%privacy.html';
COMMIT;
