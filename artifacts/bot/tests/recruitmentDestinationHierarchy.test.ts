import test from "node:test";
import assert from "node:assert/strict";
import {
 recruitmentGroups,recruitmentAreaBlockOptions,recruitmentTopicsForAreaBlock,recruitmentTopicsForGroup
} from "../src/services/recruitmentDestinationHierarchy.js";
import type {VerifiedTopic} from "../src/services/topicRouting.js";
const fixture=(id:number,board:VerifiedTopic["board"],title:string):VerifiedTopic=>({
 id,board,title,purpose:"announcement",chatId:-1003847210571,threadId:id+1,
 verifiedAt:new Date("2026-11-09T00:00:00Z"),enabled:true
});
test("recruitment hierarchy uses only verified DB options, not board URL message IDs",()=>{
 const topics=[
  fixture(101,"area_bbs","新宿"),
  fixture(102,"area_bbs","池袋"),
  fixture(103,"area_bbs","大阪キタ"),
  fixture(104,"gay_board","👤サシ"),
 ];
 assert.deepEqual(recruitmentGroups(topics).map(x=>x.board),["area_bbs","gay_board"]);
 const blocks=recruitmentAreaBlockOptions(topics);
 assert.deepEqual(blocks.map(x=>x.label),["東京","関西"]);
 const tokyo=blocks.find(x=>x.label==="東京")!;
 assert.deepEqual(recruitmentTopicsForAreaBlock(topics,tokyo.index).map(x=>x.id),[101,102]);
 assert.deepEqual(recruitmentTopicsForGroup(topics,"gay_board").map(x=>x.id),[104]);
 assert.throws(()=>recruitmentTopicsForAreaBlock(topics,999),/NOT_VERIFIED/);
 assert.throws(()=>recruitmentTopicsForGroup(topics,"area_bbs"),/BLOCK_REQUIRED/);
});
test("unknown verified area topics remain selectable in a registered-only remainder",()=>{
 const topics=[fixture(900,"area_bbs","台帳外の既存認証済みトピック")];
 const blocks=recruitmentAreaBlockOptions(topics);
 assert.equal(blocks.length,1);
 assert.equal(blocks[0]?.label,"その他の登録済みエリア");
 assert.deepEqual(blocks[0]?.topics.map(x=>x.id),[900]);
});
