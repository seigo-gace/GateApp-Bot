import test from "node:test";
import assert from "node:assert/strict";
import {PROFILE_AREA_BLOCKS,PROFILE_AREA_CATALOG,areaChildren,areaButtonRows,toggleProfileArea,validateProfileArea} from "../src/services/profileArea.js";

test("all adopted 13 blocks and children are preserved without made-up topic IDs",()=>{
 assert.deepEqual(PROFILE_AREA_BLOCKS,[
  "北海道","東北","甲信越","北陸","北関東","東京","南関東",
  "東海","関西","中国","四国","九州","沖縄",
 ]);
 assert.deepEqual(areaChildren("東京"),["池袋","新宿","渋谷","品川","都心","区東部","都下"]);
 assert.deepEqual(areaChildren("関西"),["滋賀","京都","大阪キタ","大阪ミナミ","兵庫","奈良","和歌山"]);
 assert.deepEqual(areaChildren("北海道"),["北海道"]);
 assert.deepEqual(areaChildren("沖縄"),["沖縄"]);
 assert.equal(Object.keys(PROFILE_AREA_CATALOG).length,13);
});
test("adaptive layouts are 3 default, 4 for remainder, 2 for long child labels",()=>{
 assert.deepEqual(areaButtonRows(PROFILE_AREA_BLOCKS).map(row=>row.length),[3,3,3,3,2]);
 assert.deepEqual(areaButtonRows(areaChildren("東京")).map(row=>row.length),[3,3,2]);
 assert.deepEqual(areaButtonRows(areaChildren("東北")).map(row=>row.length),[4,3]);
 assert.deepEqual(areaButtonRows(areaChildren("南関東")).map(row=>row.length),[2,2,2]);
 assert.deepEqual(areaButtonRows(areaChildren("関西")).map(row=>row.length),[3,3,2]);
 for(const b of PROFILE_AREA_BLOCKS){
  const rows=areaButtonRows(areaChildren(b));
  assert.equal(rows.flat().at(-1),"↩ 戻る");
  assert.deepEqual(rows.flat().slice(0,-1),areaChildren(b));
  assert.ok(rows.every(row=>row.length>=1&&row.length<=4));
 }
});
test("region pair is atomic and same-area selection can clear optional region",()=>{
 const a=toggleProfileArea({},"東京","新宿");
 assert.deepEqual(a,{region:"東京",area:"新宿",pendingRegion:null});
 assert.deepEqual(toggleProfileArea(a,"東京","新宿"),{region:null,area:null,pendingRegion:null});
 const b=toggleProfileArea(a,"関西","大阪キタ");
 assert.deepEqual(b,{region:"関西",area:"大阪キタ",pendingRegion:null});
 validateProfileArea(b);
 validateProfileArea({region:null,area:null,pendingRegion:"東京"});
 assert.throws(()=>validateProfileArea({area:"新宿"}),/ORPHAN/);
 assert.throws(()=>validateProfileArea({region:"東京",area:"大阪キタ"}),/CHILD_INVALID/);
 assert.throws(()=>toggleProfileArea(a,"東京","大阪キタ"),/CHILD_INVALID/);
});
