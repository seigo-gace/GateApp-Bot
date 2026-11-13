import test from "node:test";
import assert from "node:assert/strict";
import {
 jstToday,jstCurrentMonth,changePickerMonth,validPickerMonth,validPickerDay,
 pickerDateRows,pickerHourRows,pickerMinuteRows,pickerDateLabel,selectedPickerTime,
 type DateTimePickerActions,
} from "../src/services/dateTimeInlinePicker.js";

const actions:DateTimePickerActions={
 month:v=>"test:month:"+v,day:v=>"test:day:"+v,
 hour:v=>"test:hour:"+v,minute:v=>"test:minute:"+v,
 manual:"test:manual",back:"test:back",cancel:"test:cancel",
};
const at=new Date("2026-11-13T15:00:00.000Z"); // 2026-11-14 00:00 in Tokyo
test("JST month, future-date bounds, and real calendar days",()=>{
 assert.equal(jstToday(at),"20261114");
 assert.equal(jstCurrentMonth(at),"202611");
 assert.equal(changePickerMonth("202612",1),"202701");
 assert.equal(changePickerMonth("202701",-1),"202612");
 assert.equal(validPickerMonth("202611",at),true);
 assert.equal(validPickerMonth("202610",at),false);
 assert.equal(validPickerMonth("202613",at),false);
 assert.equal(validPickerDay("20261113",at),false);
 assert.equal(validPickerDay("20261114",at),true);
 assert.equal(validPickerDay("20261131",at),false);
 assert.equal(validPickerDay("20270229",at),false);
 assert.equal(validPickerDay("20280229",at),true);
 assert.equal(pickerDateLabel("20261225"),"2026/12/25");
});
test("Calendar keeps a single editable DM screen with navigation and date choices",()=>{
 const rows=pickerDateRows("202611",actions,at);
 const flat=rows.flat();
 const dates=flat.filter(b=>b.callback_data.startsWith("test:day:"));
 assert.equal(dates.length,17); // 14th through 30th
 assert.equal(dates[0]?.callback_data,"test:day:20261114");
 assert.equal(dates.at(-1)?.callback_data,"test:day:20261130");
 assert(flat.find(b=>b.callback_data==="test:month:202612"));
 assert(!flat.find(b=>b.callback_data==="test:month:202610"));
 assert(flat.find(b=>b.callback_data==="test:manual"));
 assert.equal(rows.at(-1)?.[0]?.text,"↩ 戻る");
 assert.equal(rows.at(-1)?.[1]?.text,"キャンセル");
 assert.equal(rows.at(-1)?.[1]?.style,"danger");
 assert(rows.slice(1,-2).every(row=>row.length>=2&&row.length<=7));
 const december=pickerDateRows("202612",actions,at).flat();
 assert(december.find(b=>b.callback_data==="test:month:202611"));
 assert(december.find(b=>b.callback_data==="test:month:202701"));
 assert.throws(()=>pickerDateRows("202610",actions,at));
});
test("Hours and 5-minute buttons allow date/time completion without typing",()=>{
 const hourRows=pickerHourRows(actions), minuteRows=pickerMinuteRows(actions);
 assert.deepEqual(hourRows.slice(0,6).map(row=>row.length),[4,4,4,4,4,4]);
 assert.equal(hourRows[0]?.[0]?.callback_data,"test:hour:00");
 assert.equal(hourRows[5]?.[3]?.callback_data,"test:hour:23");
 assert.deepEqual(minuteRows.slice(0,3).map(row=>row.length),[4,4,4]);
 assert.equal(minuteRows[0]?.[0]?.callback_data,"test:minute:00");
 assert.equal(minuteRows[2]?.[3]?.callback_data,"test:minute:55");
 for(const rows of [hourRows,minuteRows]){
  assert.equal(rows.at(-2)?.[0]?.callback_data,"test:manual");
  assert.equal(rows.at(-1)?.[0]?.callback_data,"test:back");
  assert.equal(rows.at(-1)?.[1]?.style,"danger");
 }
});
test("Selected button date and time uses existing JST validator",()=>{
 const result=selectedPickerTime("20991231",20,5,at);
 assert.equal(result.toISOString(),"2099-12-31T11:05:00.000Z");
 assert.throws(()=>selectedPickerTime("20261131",20,0,at));
 assert.throws(()=>selectedPickerTime("20991231",24,0,at));
 assert.throws(()=>selectedPickerTime("20991231",20,60,at));
});
