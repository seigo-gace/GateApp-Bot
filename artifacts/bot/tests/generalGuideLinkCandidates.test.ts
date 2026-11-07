import test from "node:test";
import assert from "node:assert/strict";
import {APPROVED_GUIDE_ROWS} from "../src/services/menuPanelRenderer.js";
import {GUIDE_LINK_CANDIDATES,GUIDE_DOCUMENT_TYPES,GUIDE_BOARD_KEYS,
 GUIDE_PENDING_EXTERNAL} from "../src/services/generalGuideLinkCandidates.js";

test("latest Master guide labels and positions are exact",()=>{
 assert.deepEqual(APPROVED_GUIDE_ROWS,[
  ["お知らせ","雑談","みんなのプロフ"],
  ["全国ボード","カテゴリーボード","ビデオ/動画"],
  ["検索/フィルター","使い方","リンク"],
  ["規約","規則","ルール","ガイドライン"],
 ]);
 assert.deepEqual(APPROVED_GUIDE_ROWS.map(r=>r.length),[3,3,3,4]);
 assert.equal(new Set(APPROVED_GUIDE_ROWS.flat()).size,13);
});
test("candidate links retain source groups, with no fabricated URLs",()=>{
 for(const [group,known] of Object.entries(GUIDE_LINK_CANDIDATES)){
  const gid={area_bbs:"3847210571",video_chat:"2373696859",
   gay_board:"3770334893"}[group as keyof typeof GUIDE_LINK_CANDIDATES];
  for(const [label,url] of Object.entries(known)){
   assert.ok(APPROVED_GUIDE_ROWS.flat().includes(label as never));
   assert.match(url!,new RegExp("^https://t\\.me/c/"+gid+"/[1-9][0-9]*$"));
  }
 }
 assert.equal(Object.keys(GUIDE_LINK_CANDIDATES.area_bbs).length,1);
 assert.equal(Object.keys(GUIDE_LINK_CANDIDATES.video_chat).length,4);
 assert.equal(Object.keys(GUIDE_LINK_CANDIDATES.gay_board).length,4);
});
test("four legal/help document links stay distinct; rules never masquerade as regulations",()=>{
 assert.deepEqual(Object.keys(GUIDE_DOCUMENT_TYPES),["規約","ルール","ガイドライン","使い方"]);
 assert.notEqual(GUIDE_DOCUMENT_TYPES["ルール"],GUIDE_DOCUMENT_TYPES["規約"]);
 assert.ok(!("規則" in GUIDE_DOCUMENT_TYPES));
 assert.deepEqual(Object.keys(GUIDE_BOARD_KEYS),
  ["全国ボード","カテゴリーボード","ビデオ/動画"]);
 assert.deepEqual(GUIDE_PENDING_EXTERNAL,["検索/フィルター","規則"]);
});
