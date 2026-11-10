-- Master #6725069736 verified child area URLs (34 pairs). No fabrication for pending 22.
BEGIN;
INSERT INTO topic_board_area_links (block_name, area_name, target_url, verified_by)
VALUES
  ('東北','山形','https://t.me/c/3847210571/53',7880448530),
  ('北陸','石川','https://t.me/c/3847210571/60',7880448530),
  ('東京','新宿','https://t.me/c/3847210571/66',7880448530),
  ('東京','都心','https://t.me/c/3847210571/69',7880448530),
  ('東京','区東部','https://t.me/c/3847210571/70',7880448530),
  ('南関東','横須賀・湘南・小田原','https://t.me/c/3847210571/74',7880448530),
  ('東海','愛知','https://t.me/c/3847210571/78',7880448530),
  ('東海','岐阜','https://t.me/c/3847210571/79',7880448530),
  ('東海','三重','https://t.me/c/3847210571/80',7880448530),
  ('関西','滋賀','https://t.me/c/3847210571/81',7880448530),
  ('関西','京都','https://t.me/c/3847210571/82',7880448530),
  ('関西','大阪キタ','https://t.me/c/3847210571/83',7880448530),
  ('関西','大阪ミナミ','https://t.me/c/3847210571/84',7880448530),
  ('関西','兵庫','https://t.me/c/3847210571/85',7880448530),
  ('関西','奈良','https://t.me/c/3847210571/86',7880448530),
  ('関西','和歌山','https://t.me/c/3847210571/87',7880448530),
  ('中国','鳥取','https://t.me/c/3847210571/88',7880448530),
  ('中国','島根','https://t.me/c/3847210571/89',7880448530),
  ('中国','岡山','https://t.me/c/3847210571/90',7880448530),
  ('中国','広島','https://t.me/c/3847210571/91',7880448530),
  ('中国','山口','https://t.me/c/3847210571/92',7880448530),
  ('四国','徳島','https://t.me/c/3847210571/93',7880448530),
  ('四国','香川','https://t.me/c/3847210571/94',7880448530),
  ('四国','愛媛','https://t.me/c/3847210571/95',7880448530),
  ('四国','高知','https://t.me/c/3847210571/96',7880448530),
  ('九州','福岡','https://t.me/c/3847210571/97',7880448530),
  ('九州','大分','https://t.me/c/3847210571/98',7880448530),
  ('九州','佐賀','https://t.me/c/3847210571/99',7880448530),
  ('九州','長崎','https://t.me/c/3847210571/100',7880448530),
  ('九州','熊本','https://t.me/c/3847210571/101',7880448530),
  ('九州','宮崎','https://t.me/c/3847210571/102',7880448530),
  ('九州','鹿児島','https://t.me/c/3847210571/103',7880448530),
  ('北海道','北海道','https://t.me/c/3847210571/49',7880448530),
  ('沖縄','沖縄','https://t.me/c/3847210571/104',7880448530)
ON CONFLICT (block_name, area_name) DO UPDATE SET
  target_url=EXCLUDED.target_url, verified_by=EXCLUDED.verified_by, verified_at=NOW();
UPDATE general_guide_links SET destination_url='https://tgtumbler-docs.pages.dev/privacy'
  WHERE link_key='privacy' AND label='規則';
UPDATE general_guide_links SET destination_url='https://t.me/c/3847210571/1', label='お知らせ'
  WHERE chat_id=-1003847210571 AND link_key='news';
UPDATE general_guide_links SET destination_url='https://t.me/c/3847210571/116', label='雑談'
  WHERE chat_id=-1003847210571 AND link_key='freetalk';
COMMIT;
