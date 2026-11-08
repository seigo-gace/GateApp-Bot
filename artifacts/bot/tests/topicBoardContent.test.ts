import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_TOPICS,
  CATEGORY_TOPICS,
  AREA_BLOCKS,
  buildTopicBoardHtml,
  buildNationalBoardHtml,
  buildAreaBlockPanel,
  resolveBlockChildUrls,
  resolveBlockChildUrlsPartial,
  AREA_BLOCK_SEARCH_URL,
  AREA_BLOCK_FREETALK_URL,
} from "../src/services/topicBoardContent.js";

test("topic list counts match approved menus", () => {
  assert.equal(VIDEO_TOPICS.length, 7);
  assert.equal(CATEGORY_TOPICS.length, 9);
  assert.equal(AREA_BLOCKS.length, 13);
});

test("L1 video/category indexes link topic titles in HTML body", () => {
  for (const board of ["video", "category"] as const) {
    const html = buildTopicBoardHtml(board);
    assert.ok(html.length <= 4096);
    assert.doesNotMatch(html, /総合案内|コミュニティリンク|掲示板を開く/);
    const topics = board === "video" ? VIDEO_TOPICS : CATEGORY_TOPICS;
    for (const entry of topics) {
      assert.ok(html.includes(entry.url));
      assert.match(html, new RegExp(`<a href="${entry.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
    }
  }
});

test("national index links all child areas including 静岡/77", () => {
  const html = buildNationalBoardHtml({});
  assert.ok(html.includes("https://t.me/c/3847210571/50"));
  assert.ok(html.includes("https://t.me/c/3847210571/77"));
  assert.ok(html.includes("静岡"));
});

test("partial block resolve matches Master-verified DB rows", () => {
  const db = {
    "東北/山形": "https://t.me/c/3847210571/53",
    "東京/新宿": "https://t.me/c/3847210571/66",
  };
  const tohoku = resolveBlockChildUrlsPartial("東北", db);
  assert.equal(Object.keys(tohoku).length, 1);
  assert.throws(() => resolveBlockChildUrls("東北", db), /AREA_CHILD_LINK_UNVERIFIED:東北\/青森/);
});

test("area block L1 uses inline keyboard via renderAreaBlockBoard", () => {
  const resolved = resolveBlockChildUrls("北海道", {});
  const panel = buildAreaBlockPanel("北海道", resolved, {
    search: AREA_BLOCK_SEARCH_URL,
    filter: AREA_BLOCK_SEARCH_URL,
    chat: AREA_BLOCK_FREETALK_URL,
    back: "https://t.me/c/3847210571/1166",
  });
  assert.ok(panel.rows.length >= 3);
  assert.throws(() => resolveBlockChildUrls("東北", {}), /AREA_CHILD_LINK_UNVERIFIED/);
});
