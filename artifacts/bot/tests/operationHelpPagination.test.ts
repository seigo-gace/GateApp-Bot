import test from "node:test";
import assert from "node:assert/strict";
import {APPROVED_POSTING_ROWS} from "../src/services/menuPanelRenderer.js";
import {CHAT_TOPIC_CHOICES} from "../src/services/dmBareStartPostingMenu.js";
import {helpHomeKeyboard,helpChatTopicKeyboard,helpSectionKeyboard,helpTopicPages,helpTagPages,helpTagKeyboard} from "../src/bot/operationHelpHandlers.js";

const topics=["recruit","room","announcement","profile","paid","link","search","chat"] as const;
const labels=(rows:ReturnType<typeof helpHomeKeyboard>["reply_markup"]["inline_keyboard"])=>
 rows.map(row=>row.map(item=>item.text));

test("operation help preserves posting-menu order without unnecessary invitation explanation",()=>{
 const actual=labels(helpHomeKeyboard(7).reply_markup.inline_keyboard);
 const expected=APPROVED_POSTING_ROWS.map(row=>row.filter(item=>item!=="紹介/招待").map(item=>item==="操作説明"?"戻る":item));
 assert.deepEqual(actual,expected);
});

test("all eight described features use short multi-page Telegram text, with no content dropped",()=>{
 for(const topic of topics){
  const pages=helpTopicPages(topic);
  assert.ok(pages.length>=2,topic);
  for(const page of pages){
   assert.ok(page.length<=4096,topic+" too long");
   assert.match(page,/\d+ \/ \d+/,topic+" missing position");
  }
  assert.ok(pages[0].includes("【")||pages[0].includes("■"),topic+" missing purpose");
  const first=helpSectionKeyboard(12,topic,0).reply_markup.inline_keyboard.flat();
  if(topic!=="chat")assert.ok(first.some(b=>b.text==="次 ➔"),topic+" has no Next");
  const last=helpSectionKeyboard(12,topic,pages.length-1).reply_markup.inline_keyboard.flat();
  assert.ok(last.some(b=>b.text==="⬅ 前へ"),topic+" has no Previous");
  assert.equal(last.some(b=>b.text==="次 ➔"),false,topic+" leaked Next");
 }
});

test("Like and Love have same short page navigation and remain accessible from all relevant help",()=>{
 const pages=helpTagPages();
 assert.ok(pages.length>=3);
 assert.ok(pages.every(x=>x.length<=4096));
 assert.ok(helpTagKeyboard(9,0).reply_markup.inline_keyboard.flat().some(b=>b.text==="次 ➔"));
 assert.ok(helpTagKeyboard(9,pages.length-1).reply_markup.inline_keyboard.flat().some(b=>b.text==="⬅ 前へ"));
 for(const topic of ["recruit","room","profile"] as const){
  assert.ok(helpSectionKeyboard(9,topic,0).reply_markup.inline_keyboard.flat()
    .some(b=>b.text.includes("#Like・#Love")),topic);
 }
});

test("link guide describes new 2-line entry and next-row versus horizontal action",()=>{
 const guide=helpTopicPages("link").join("\n");
 assert.match(guide,/1行目：ボタンに表示する名前/);
 assert.match(guide,/2行目：https:\/\//);
 assert.match(guide,/➡️ 横にボタンを作る/);
 assert.match(guide,/➕ ボタンを追加/);
 assert.match(guide,/画像＋コメント/);
 assert.match(guide,/未実装/);
 assert.doesNotMatch(guide,/表示名 \| https:/);
});

test("Chat in help leads to exactly the three specified message links",()=>{
 const keyboard=helpHomeKeyboard(7).reply_markup.inline_keyboard.flat();
 const talk=keyboard.find(item=>item.text==="雑談");
 assert.ok(talk&&"callback_data" in talk);
 assert.equal(talk.callback_data,"help:chatselect:7");
 assert.deepEqual(CHAT_TOPIC_CHOICES.map(item=>item.url),[
  "https://t.me/c/2373696859/4291",
  "https://t.me/c/3847210571/44",
  "https://t.me/c/3770334893/789",
 ]);
 assert.equal(keyboard.some(item=>item.text==="紹介/招待"),false);
 const choices=helpChatTopicKeyboard(8).reply_markup.inline_keyboard;
 assert.deepEqual(choices.slice(0,3).map(row=>row[0]?.text),CHAT_TOPIC_CHOICES.map(item=>item.label));
 assert.deepEqual(choices.slice(0,3).map(row=>"url" in row[0]! ? row[0]!.url : undefined),CHAT_TOPIC_CHOICES.map(item=>item.url));
 assert.equal(choices[3]?.[0]?.text,"↩ 操作説明へ戻る");
});
