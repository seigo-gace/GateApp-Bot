import {test} from "node:test";
import assert from "node:assert/strict";
import {searchHomeRows,searchFilterRows} from "../src/bot/searchHandlers.js";
import type {SearchSession} from "../src/services/searchRepository.js";
import {initialSearchFilters} from "../src/services/searchDomain.js";

const session=(kind:"profile"|"recruitment"="profile")=>({
 revision:1,filters:{...initialSearchFilters(),kind}
}) as SearchSession;

test("search home: chosen kind green, actions blue, clear red, back neutral",()=>{
 const rows=searchHomeRows(session());
 assert.equal(rows[0]![0]!.style,"primary");
 assert.equal(rows[0]![1]!.style,"primary");
 assert.equal(rows[1]![0]!.style,"success");
 assert.equal(rows[1]![1]!.style,undefined);
 assert.equal(rows[2]![0]!.style,"primary");
 assert.equal(rows[2]![1]!.style,"danger");
 assert.equal(rows[3]![0]!.style,undefined);
 const alternate=searchHomeRows(session("recruitment"));
 assert.equal(alternate[1]![0]!.style,undefined);
 assert.equal(alternate[1]![1]!.style,"success");
 assert.equal(alternate[1]![1]!.callback_data,"search:kind:1:recruitment");
});

test("search detailed filters keep the existing callbacks and blue action style",()=>{
 const rows=searchFilterRows(session());
 assert.equal(rows.length,4);
 assert.equal(rows[0]![0]!.callback_data,"search:panel:1:region");
 assert.equal(rows[0]![0]!.style,"primary");
 assert.equal(rows[2]![0]!.callback_data,"search:tag:1:like");
 assert.equal(rows[2]![0]!.style,"primary");
 assert.equal(rows[3]![0]!.style,"primary");
 assert.equal(rows[3]![1]!.style,undefined);
});
