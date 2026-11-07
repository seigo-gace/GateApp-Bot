import test from "node:test";
import assert from "node:assert/strict";
import {PROFILE_AREA_BLOCKS} from "../src/services/profileArea.js";
import {PROFILE_POSITIONS} from "../src/services/profileCore.js";
import {PURPOSE_TAGS} from "../src/services/announcementTags.js";
import {HAIR_CHOICES,BODY_CHOICES} from "../src/services/profileAppearance.js";
import {LIKE_CATEGORIES} from "../src/services/profileLike.js";
import {initialSearchFilters,setSearchFilter,toggleSearchTag,parseSearchAge,searchOptions,validateSearch,
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

test("appearance and Like/Love filters use adopted existing choices",()=>{
 assert.deepEqual(searchOptions("hair"),HAIR_CHOICES);
 assert.deepEqual(searchOptions("body"),BODY_CHOICES);
 let f=setSearchFilter(initialSearchFilters(),"hair","坊主");
 f=setSearchFilter(f,"body","筋肉質");
 assert.equal(f.hair,"坊主");
 assert.equal(f.body,"筋肉質");
 f=toggleSearchTag(f,"like",0,0);
 f=toggleSearchTag(f,"love",1,0);
 assert.deepEqual(f.like,{category:LIKE_CATEGORIES[0].name,tag:LIKE_CATEGORIES[0].items[0]});
 assert.deepEqual(f.love,{category:LIKE_CATEGORIES[1].name,tag:LIKE_CATEGORIES[1].items[0]});
 f=toggleSearchTag(f,"like",0,0);
 assert.equal(f.like,null,"reselecting same optional tag clears only Like");
 assert.ok(f.love,"Love choice must remain intact");
 assert.throws(()=>toggleSearchTag(f,"like",99,0),/SEARCH_TAG_INVALID/);
 assert.deepEqual(validateSearch(f),f);
});
test("age search accepts existing 18–89 bounds and rejects partial/invalid ranges",()=>{
 assert.deepEqual(parseSearchAge("35"),{ageMin:35,ageMax:35});
 assert.deepEqual(parseSearchAge("18-49"),{ageMin:18,ageMax:49});
 assert.deepEqual(parseSearchAge("50〜89"),{ageMin:50,ageMax:89});
 for(const value of ["17","90","70-20","18-90","12-30","abc"])
  assert.throws(()=>parseSearchAge(value),/SEARCH_AGE/);
 assert.throws(()=>validateSearch({...initialSearchFilters(),ageMin:18,ageMax:90}),/SEARCH_FILTER_INVALID/);
});
