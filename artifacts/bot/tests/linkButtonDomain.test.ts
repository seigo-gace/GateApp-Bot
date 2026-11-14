import test from "node:test";
import assert from "node:assert/strict";
import {parseLinkInput,parseLinkButtonPair,buttonGrid,renderLinkCard,validateLinkDestination,validateLinkDraft} from "../src/services/linkButtonDomain.js";

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

test("Telegram two-line single-send name and URL input",()=>{
 const item=parseLinkButtonPair("🔗 グループへ参加\nhttps://example.org/join");
 assert.deepEqual(item,{label:"🔗 グループへ参加",url:"https://example.org/join"});
 assert.equal(parseLinkButtonPair("案内\r\nhttps://example.org/").label,"案内");
 for(const invalid of ["案内","案内\n","\nhttps://example.org","案内\nhttp://example.org","案内\nhttps://bit.ly/1","案内\nhttps://example.org\n余分"])
  assert.throws(()=>parseLinkButtonPair(invalid));
});

test("horizontal add starts no new row and next-row add preserves prior rows",()=>{
 const pair=(label:string,rowStart:boolean)=>({...parseLinkButtonPair(label+"\nhttps://example.org/"),rowStart});
 const first=pair("1",true);
 const second=pair("2",false);
 const third=pair("3",true);
 const fourth=pair("4",false);
 const draft={text:"画像の投稿",buttons:[first,second,third,fourth],columns:1 as const};
 assert.deepEqual(buttonGrid(draft).map(row=>row.map(b=>b.label)),[["1","2"],["3","4"]]);
 assert.deepEqual(buttonGrid({...draft,buttons:[first]}).map(row=>row.map(b=>b.label)),[["1"]]);
 assert.deepEqual(buttonGrid({...draft,buttons:[first,second]}).map(row=>row.map(b=>b.label)),[["1","2"]]);
});

