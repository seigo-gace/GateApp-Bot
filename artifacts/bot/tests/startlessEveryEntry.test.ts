import test from "node:test";
import assert from "node:assert/strict";
import {helpReturnToPostingKeyboard} from "../src/bot/operationHelpHandlers.js";
import {publicNavigationButton} from "../src/services/startlessNavigation.js";

test("all Help returns in an existing DM use a callback, never Start",()=>{
 const button=helpReturnToPostingKeyboard().reply_markup.inline_keyboard[0][0] as
  {text:string;callback_data?:string;url?:string};
 assert.equal(button.text,"↩ 投稿メニュー");
 assert.equal(button.callback_data,"dm:utility:home");
 assert.equal(button.url,undefined);
});
test("all routine group menu Bot links are normalized into private DM callbacks",()=>{
 for(const p of ["search","help","bugreport","talk","invite","link",
  "p_"+"A".repeat(32),"m_"+"B".repeat(32),"r_"+"C".repeat(32),
  "j_"+"D".repeat(32),"a_"+"E".repeat(32),
  "pv_"+"F".repeat(32),"pm_"+"G".repeat(32),"pt_"+"H".repeat(32)]){
  const b=publicNavigationButton({text:"入口",url:"https://t.me/GayBBS_bot?start="+p});
  assert.equal(b.url,undefined,p);
  assert.equal(b.callback_data,"gdm:"+p,p);
 }
});
