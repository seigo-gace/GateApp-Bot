import test from "node:test";
import assert from "node:assert/strict";
import {searchHomeRows,searchFilterRows} from "../src/bot/searchHandlers.js";
import {initialSearchFilters} from "../src/services/searchDomain.js";
import type {SearchSession} from "../src/services/searchRepository.js";
const make=(kind:"profile"|"recruitment"):SearchSession=>({
 revision:31,step:"home",screenMessageId:123,filters:{...initialSearchFilters(),kind}
});
const texts=(rows:ReturnType<typeof searchHomeRows>)=>
 rows.map(row=>row.map(button=>button.text));
test("shared search home has real callback actions without filler",()=>{
 const result=searchHomeRows(make("profile"));
 assert.deepEqual(result.map(row=>row.length),[2,2,2,1]);
 assert.deepEqual(texts(result)[0],["🔍 キーワード検索","🎛 詳細フィルター"]);
 assert.deepEqual(texts(result)[3],["↩ 戻る"]);
});
test("profile filters preserve familiar multi-column adopted categories",()=>{
 const result=searchFilterRows(make("profile"));
 assert.deepEqual(result.map(row=>row.length),[3,3,2,2]);
 assert.deepEqual(texts(result),[
  ["📍 エリア","年齢","ポジション"],
  ["体型","髪型","目的"],
  ["#Like","#Love"],
  ["🔎 検索実行","↩ 戻る"],
 ]);
});
test("recruitment filters do not expose profile-only categories",()=>{
 const result=searchFilterRows(make("recruitment"));
 assert.deepEqual(result.map(row=>row.length),[3,2]);
 assert.deepEqual(texts(result),[
  ["📍 エリア","ポジション","目的"],
  ["🔎 検索実行","↩ 戻る"],
 ]);
});
