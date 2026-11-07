import test from "node:test";
import assert from "node:assert/strict";
import {parseLinkInput,buttonGrid,renderLinkCard,validateLinkDestination,validateLinkDraft} from "../src/services/linkButtonDomain.js";

test("Notion LinkButton format, same draft, and 1–3 grid columns",()=>{
 const parsed=parseLinkInput("見てください\n公式 | https://example.org/a\n案内 | https://t.me/GayBBS_bot");
 assert.equal(parsed.buttons.length,2);
 for(const columns of [1,2,3] as const){
  const d=validateLinkDraft({...parsed,columns});
  const rows=buttonGrid(d);
  assert.equal(rows.flat().length,2);
  assert.ok(rows.every(r=>r.length<=columns));
 }
});
test("never inject HTML or accept password/shortener/private/HTTP URL",()=>{
 const parsed=parseLinkInput("<b>安全</b>\nホーム | https://example.org/");
 assert.match(renderLinkCard({...parsed,columns:1}),/&lt;b&gt;安全&lt;\/b&gt;/);
 for(const u of [
  "http://example.org","https://bit.ly/foo","https://u:p@example.org",
  "https://127.0.0.1/","https://192.168.1.3/","https://localhost/",
  "https://[::1]/","javascript:alert(1)","https://example.org:8443/a",
 ]){
  assert.throws(()=>validateLinkDestination(u),u);
 }
});
test("malformed button, missing body and invalid column count are refused",()=>{
 assert.throws(()=>parseLinkInput("本文だけ"));
 assert.throws(()=>parseLinkInput("本文\nURLだけ"));
 assert.throws(()=>validateLinkDraft({text:"本文",buttons:[],columns:1}));
 assert.throws(()=>validateLinkDraft({text:"本文",buttons:[{label:"表示",url:"https://example.org"}],columns:4 as 1}));
});

// The existing LinkButton DM editor must keep its buttons interactive, not chat text.
test("LinkButton preview offers 1–3 columns, edit and cancel in the same message",async()=>{
 const {linkPreviewKeyboard}=await import("../src/bot/postingHandlers.js");
 const panel=linkPreviewKeyboard({module:"link",step:"preview",revision:8,
  data:{columns:2,buttons:[{label:"案内",url:"https://example.org"}],text:"説明"}});
 const rows=panel.reply_markup.inline_keyboard;
 assert.deepEqual(rows.map(row=>row.length),[3,2]);
 assert.deepEqual(rows[0].map(button=>button.callback_data),[
  "post:linkcols:8:1","post:linkcols:8:2","post:linkcols:8:3"]);
 assert.ok(rows[0][1].text.startsWith("✅"));
 assert.deepEqual(rows[1].map(button=>button.callback_data),[
  "post:link:edit:8","post:link:cancel:8"]);
});
test("trailing-dot shorteners and local suffixes remain blocked",()=>{
 for(const url of ["https://bit.ly./a","https://localhost./",
  "https://example.local./","https://example.internal./"]){
  assert.throws(()=>validateLinkDestination(url),url);
 }
});
