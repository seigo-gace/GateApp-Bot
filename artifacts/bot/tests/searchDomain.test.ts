import test from "node:test";
import assert from "node:assert/strict";
import {PROFILE_AREA_BLOCKS} from "../src/services/profileArea.js";
import {PROFILE_POSITIONS} from "../src/services/profileCore.js";
import {PURPOSE_TAGS} from "../src/services/announcementTags.js";
import {initialSearchFilters,setSearchFilter,searchOptions,validateSearch,
 telegramPublishedMessageUrl} from "../src/services/searchDomain.js";

test("search uses approved existing area/position/purpose catalogs only",()=>{
 assert.deepEqual(searchOptions("region"),PROFILE_AREA_BLOCKS);
 assert.deepEqual(searchOptions("position"),PROFILE_POSITIONS);
 assert.deepEqual(searchOptions("purpose"),PURPOSE_TAGS);
 const source=initialSearchFilters();
 let f=setSearchFilter(source,"region","東京");
 assert.deepEqual(source,initialSearchFilters(),"never mutate original filters");
 assert.equal(f.region,"東京");
 f=setSearchFilter(f,"position","リバ");
 f=setSearchFilter(f,"purpose","サシ");
 assert.deepEqual([f.region,f.position,f.purpose],["東京","リバ","サシ"]);
 f=setSearchFilter(f,"region","東京");
 assert.equal(f.region,null,"optional filter toggles off");
 assert.throws(()=>setSearchFilter(f,"region","架空地域"),/SEARCH_OPTION_INVALID/);
});

test("search rejects unexpected keys and invalid keyword length",()=>{
 assert.throws(()=>validateSearch({...initialSearchFilters(),keyword:"a".repeat(81)}),/SEARCH_FILTER_INVALID/);
 assert.throws(()=>validateSearch({...initialSearchFilters(),keyword:"X\nY"}),/SEARCH_FILTER_INVALID/);
 assert.throws(()=>validateSearch({...initialSearchFilters(),position:"未登録"}),/SEARCH_FILTER_INVALID/);
 assert.throws(()=>validateSearch({...initialSearchFilters(),kind:"invalid" as any}),/SEARCH_FILTER_INVALID/);
});

test("search links point only to verified Telegram message IDs",()=>{
 assert.equal(telegramPublishedMessageUrl(-1003847210571,455),
 "https://t.me/c/3847210571/455");
 for(const [chat,message] of [[-1,455],[1003847210571,455],[-1003847210571,0],[-1003847210571,1.5]])
  assert.throws(()=>telegramPublishedMessageUrl(chat,message),/SEARCH_PUBLIC_LINK_UNVERIFIED/);
});
