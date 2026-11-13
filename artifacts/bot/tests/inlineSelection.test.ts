import test from "node:test";
import assert from "node:assert/strict";
import {nextSelection,selectionLabel,selectionRows,positionChoiceRows} from "../src/services/inlineSelection.js";

const choices=["A","B","C"] as const;
test("required single click never turns off mandatory current value",()=>{
 assert.deepEqual(nextSelection("single-required",[],"A",choices),["A"]);
 assert.deepEqual(nextSelection("single-required",["A"],"A",choices),["A"]);
 assert.deepEqual(nextSelection("single-required",["A"],"B",choices),["B"]);
});
test("optional single click toggles to unselected and can replace",()=>{
 assert.deepEqual(nextSelection("single-optional",[],"A",choices),["A"]);
 assert.deepEqual(nextSelection("single-optional",["A"],"A",choices),[]);
 assert.deepEqual(nextSelection("single-optional",["A"],"B",choices),["B"]);
});
test("multiple choice independently toggles without clearing other values",()=>{
 assert.deepEqual(nextSelection("multiple",["A","B"],"B",choices),["A"]);
 assert.deepEqual(nextSelection("multiple",["A"],"C",choices),["A","C"]);
 assert.deepEqual(nextSelection("multiple",["A","C"],"A",choices),["C"]);
});
test("reject unknown and malformed selection state",()=>{
 assert.throws(()=>nextSelection("multiple",["A"],"X" as any,choices),/OPTION_INVALID/);
 assert.throws(()=>nextSelection("multiple",["A","A"],"B",choices),/STATE_INVALID/);
 assert.throws(()=>nextSelection("single-optional",["A","B"],"C",choices),/STATE_INVALID/);
 assert.throws(()=>nextSelection("single-required",["X" as any],"A",choices),/STATE_INVALID/);
 assert.throws(()=>nextSelection("invalid" as any,[],"A",choices),/MODE_INVALID/);
});
test("render selected checkmarks and Telegram callback-only buttons",()=>{
 const rows=selectionRows([["A","B"],["C"]],["B"],x=>"tag:2:"+x);
 assert.deepEqual(rows.map(row=>row.map(x=>x.text)),[["▫️ A","✅ B"],["▫️ C"]]);
 assert.deepEqual(rows[0]!.map(x=>x.callback_data),["tag:2:A","tag:2:B"]);
 assert.equal(selectionLabel("A",true),"✅ A");
 assert.throws(()=>selectionRows([["A","A"]],[],x=>"x:"+x),/DUPLICATE/);
 assert.throws(()=>selectionRows([["A"]],[],()=> "x".repeat(65)),/CALLBACK_INVALID/);
});

test("shared 3+4 position options preserve all seven choices across owners",()=>{
 const values=["タチ","タチリバ","リバ","ウケリバ","ウケ","S","M"] as const;
 const rows=positionChoiceRows(values,undefined,(_value,index)=>"room:positionchoice:7:"+index);
 assert.deepEqual(rows.map(row=>row.length),[3,4]);
 assert.deepEqual(rows.flat().map(b=>b.text),[...values]);
 assert.deepEqual(rows.flat().map(b=>b.callback_data),
  values.map((_value,i)=>"room:positionchoice:7:"+i));
 const profile=positionChoiceRows(values,"ウケ",(_value,index)=>"pf:pos:8:"+index,true);
 assert.equal(profile.flat()[4]?.text,"✅ ウケ");
 assert.equal(profile.flat()[0]?.text,"▫️ タチ");
});
