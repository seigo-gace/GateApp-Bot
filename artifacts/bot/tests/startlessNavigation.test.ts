import test from "node:test";
import assert from "node:assert/strict";
import {callbackStartlessPayload,publicNavigationButton,startlessPayload} from "../src/services/startlessNavigation.js";
import {createTelegramDispatcher} from "../src/services/telegramDispatcher.js";

test("the common public transport never exposes repeated Start for routine features",()=>{
 const tokens=["m_"+ "A".repeat(32),"r_"+"B".repeat(32),"p_"+"C".repeat(32),
  "j_"+"D".repeat(32),"a_"+"E".repeat(32),
  "pv_"+"F".repeat(32),"pm_"+"G".repeat(32),"pt_"+"H".repeat(32),
  "search","help","bugreport","talk","invite","link"];
 for(const payload of tokens){
  const url="https://t.me/GayBBS_bot?start="+payload;
  assert.equal(startlessPayload(url),payload);
  const button=publicNavigationButton({text:"入口",url,style:"primary"});
  assert.equal(button.url,undefined);
  assert.equal(button.callback_data,"gdm:"+payload);
  assert.equal(callbackStartlessPayload(button.callback_data!),payload);
  assert.ok(button.callback_data!.length<=64);
 }
});
test("first-time gate/online links and external safe URLs are not transformed into internal callbacks",()=>{
 for(const url of ["https://t.me/GayBBS_bot?start=gate_abcd",
  "https://t.me/GayBBS_bot?start=online_abcd",
  "https://t.me/c/3847210571/44","https://t.me/someone"]){
  const b=publicNavigationButton({text:"入口",url});
  assert.equal(b.url,url);assert.equal(b.callback_data,undefined);
 }
 assert.equal(publicNavigationButton({text:"クリエーター投稿",url:"https://t.me/CreateVdobot?start=creator"}).url,
  "https://t.me/CreateVdobot");
 assert.equal(startlessPayload("https://attacker.example/GayBBS_bot?start=search"),null);
 assert.equal(startlessPayload("https://t.me/GayBBS_bot?start=search&other=1"),null);
});
test("group posting dispatcher builds original label and one callback, not the start URL",async()=>{
 const captured:any[]=[];
 const telegram={
  async sendMessage(chatId:number,text:string,extra:any){
   captured.push({chatId,text,keyboard:extra.reply_markup.inline_keyboard});
   return {message_id:77};
  },
 } as any;
 const d=createTelegramDispatcher(telegram);
 await d.publish({chatId:-1003847210571,threadId:44},{text:"投稿メニュー",buttons:[
  [{text:"検索/フィルター",url:"https://t.me/GayBBS_bot?start=search",style:"primary"}],
  [{text:"クリエーター投稿",url:"https://t.me/CreateVdobot?start=creator"}],
 ]});
 assert.equal(captured.length,1);
 const rows=captured[0].keyboard;
 assert.deepEqual(rows[0].map((b:any)=>b.text),["検索/フィルター"]);
 assert.equal(rows[0][0].callback_data,"gdm:search");
 assert.equal(rows[0][0].url,undefined);
 assert.equal(rows[1][0].url,"https://t.me/CreateVdobot");
});

test("never publish an unsupported GayBBS /start deep link in routine public keyboards",()=>{
 for(const url of [
  "https://t.me/GayBBS_bot?start=unknown",
  "https://telegram.me/gaybbs_bot?start=creator",
  "https://t.me/GayBBS_bot?start=p_invalid",
  "https://t.me/GayBBS_bot?start=search&foo=1",
  "https://t.me/GayBBS_bot?start=search#fragment",
 ]){
  assert.throws(()=>publicNavigationButton({text:"投稿はこちら",url}),
   /STARTLESS_REPEATED_START_LINK_FORBIDDEN/);
 }
 for(const url of [
  "https://t.me/GayBBS_bot?start=gate_valid",
  "https://t.me/GayBBS_bot?start=online_valid",
 ]){
  assert.equal(publicNavigationButton({text:"初回だけ",url}).url,url);
 }
 assert.throws(()=>publicNavigationButton({
  text:"競合",url:"https://t.me/GayBBS_bot?start=search",
  callback_data:"old",
 }),/STARTLESS_BUTTON_TRANSPORT_CONFLICT/);
});
