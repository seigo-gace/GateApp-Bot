import test from "node:test";
import assert from "node:assert/strict";
import {
 VIDEO_TOPICS,CATEGORY_TOPICS,AREA_BLOCKS,
 renderTopicBoard,renderNationalBoard,renderAreaBlock,
} from "../src/services/topicBoardContent.js";
test("all designated topic links are present, no menu-only destinations",()=>{
 assert.equal(VIDEO_TOPICS.length,7);
 assert.equal(CATEGORY_TOPICS.length,9);
 assert.equal(AREA_BLOCKS.length,13);
 const video=renderTopicBoard("video"), category=renderTopicBoard("category");
 assert.match(video,/2373696859\/1695/);
 assert.match(category,/3770334893\/41/);
 for(const text of [video,category]){
  assert.doesNotMatch(text,/総合案内|コミュニティリンク|フリートーク|雑談/);
  assert.ok(text.length<=4096);
  assert.equal((text.match(/掲示板を開く/g)||[]).length,text===video?7:9);
 }
});
test("national board links to all 13 known historical block anchors",()=>{
 const body=renderNationalBoard();
 for(const block of AREA_BLOCKS)assert.ok(body.includes(block.url));
 assert.ok(body.length<=4096);
 assert.doesNotMatch(body,/総合案内|コミュニティリンク|雑談/);
});
test("unverified area child links fail closed, supplied verified mapping completes",()=>{
 assert.throws(()=>renderAreaBlock("東北"),/AREA_CHILD_LINK_UNVERIFIED:東北\/青森/);
 const mapped={
  "東北/青森":"https://t.me/c/3847210571/12345",
  "東北/秋田":"https://t.me/c/3847210571/12346",
  "東北/岩手":"https://t.me/c/3847210571/12347",
  "東北/宮城":"https://t.me/c/3847210571/12348",
  "東北/福島":"https://t.me/c/3847210571/12349",
 };
 const text=renderAreaBlock("東北",mapped);
 assert.match(text,/3847210571\/53/);
 assert.match(text,/3847210571\/12345/);
 assert.throws(()=>renderAreaBlock("東北",{...mapped,"東北/青森":"https://t.me/c/2373696859/1"}),/BOARD_LINK_INVALID/);
 assert.throws(()=>renderAreaBlock("架空"),/AREA_BLOCK_UNKNOWN/);
});
test("historically ambiguous or incomplete child ID never becomes a guessed topic thread",()=>{
 for(const group of [VIDEO_TOPICS,CATEGORY_TOPICS]){
  assert.equal(new Set(group.map(x=>x.url)).size,group.length);
 }
 assert.match(renderAreaBlock("北海道"),/3847210571\/49/);
 assert.match(renderAreaBlock("沖縄"),/3847210571\/104/);
});
