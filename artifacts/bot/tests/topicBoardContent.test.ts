import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_TOPICS,
  CATEGORY_TOPICS,
  AREA_BLOCKS,
  buildTopicBoardPanel,
  buildNationalBoardPanel,
  buildAreaBlockPanel,
  resolveBlockChildUrls,
  AREA_BLOCK_SEARCH_URL,
  AREA_BLOCK_FREETALK_URL,
} from "../src/services/topicBoardContent.js";

test("topic list counts match approved menus", () => {
  assert.equal(VIDEO_TOPICS.length, 7);
  assert.equal(CATEGORY_TOPICS.length, 9);
  assert.equal(AREA_BLOCKS.length, 13);
});

test("video and category panels expose URL inline keyboard rows", () => {
  for (const board of ["video", "category"] as const) {
    const panel = buildTopicBoardPanel(board);
    assert.ok(panel.text.length <= 4096);
    assert.doesNotMatch(panel.text, /総合案内|コミュニティリンク/);
    const flat = panel.rows.flat();
    assert.equal(flat.length, board === "video" ? 7 : 9);
    const topics = board === "video" ? VIDEO_TOPICS : CATEGORY_TOPICS;
    for (const entry of topics) assert.ok(flat.some((b) => b.url === entry.url));
  }
});

test("national panel links all 13 blocks as buttons without child decoration text", () => {
  const panel = buildNationalBoardPanel({});
  assert.ok(panel.text.includes("全国エリアボード"));
  assert.doesNotMatch(panel.text, /・/);
  const flat = panel.rows.flat();
  assert.equal(flat.length, 13);
  for (const block of AREA_BLOCKS) assert.ok(flat.some((b) => b.url === block.url));
});

test("area block panel uses renderAreaBlockBoard layout with nav row", () => {
  const resolved = resolveBlockChildUrls("北海道", {});
  const panel = buildAreaBlockPanel("北海道", resolved, {
    search: AREA_BLOCK_SEARCH_URL,
    filter: AREA_BLOCK_SEARCH_URL,
    chat: AREA_BLOCK_FREETALK_URL,
    back: "https://t.me/c/3847210571/1166",
  });
  assert.ok(panel.rows.length >= 3);
  const last = panel.rows.at(-1)!;
  assert.equal(last.length, 2);
  assert.throws(() => resolveBlockChildUrls("東北", {}), /AREA_CHILD_LINK_UNVERIFIED/);
});
