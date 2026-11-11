import assert from "node:assert/strict";
import test from "node:test";
import {AREA_BLOCKS} from "../src/services/topicBoardContent.js";

test("all 56 existing L2 area targets remain in scope, no L0/L1 substitutes",()=>{
 const children=AREA_BLOCKS.flatMap(b=>b.children.map(c=>({
  block:b.label,title:c.label,url:c.url,
 })));
 assert.equal(AREA_BLOCKS.length,13);
 assert.equal(children.length,56);
 assert.equal(new Set(children.map(x=>x.url)).size,56);
 const candidates=children.map(c=>{
  const match=/^https:\/\/t\.me\/c\/3847210571\/([1-9][0-9]*)$/.exec(c.url??"");
  assert.ok(match,"Each child has a canonical area URL: "+c.block+"/"+c.title);
  return Number(match[1]);
 });
 assert.deepEqual([...candidates].sort((a,b)=>a-b),Array.from({length:56},(_,i)=>i+49));
 const parentLinks=AREA_BLOCKS.map(b=>b.url);
 for(const c of children.filter(c=>!["北海道","沖縄"].includes(c.block)))
  assert.equal(parentLinks.includes(c.url!),false,"A region block must not be used as a child posting topic");
});
