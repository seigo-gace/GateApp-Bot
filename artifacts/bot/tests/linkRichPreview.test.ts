import test from "node:test";
import assert from "node:assert/strict";
import {linkRichPreview,linkRichPlacement,linkRichContentEditor} from "../src/services/linkRichPreview.js";
import {insertLinkButton,buttonGrid,parseLinkButtonPair,type LinkDraft} from "../src/services/linkButtonDomain.js";

const draft:LinkDraft={
 text:"キャプションのテスト",columns:1,buttons:[
  {label:"サイト１",url:"https://example.org/",rowStart:true},
  {label:"サイト２",url:"https://example.com/",rowStart:false,style:"primary"},
  {label:"サイト３",url:"https://example.net/",rowStart:true,style:"success"},
 ],media:{type:"photo",fileId:"telegram_file_reference"},captionAbove:false,
};
const serialized=(v:unknown)=>JSON.stringify(v);

test("③ real URL buttons and exactly two in-body edit entrances, no register/cancel inside content",()=>{
 const view=linkRichPreview(draft,21);
 const text=serialized(view);
 assert.match(text,/post:link:panel:21/);
 assert.match(text,/post:link:content:21/);
 assert.equal((text.match(/post:link:(?:panel|content):21/g)||[]).length,2);
 assert.doesNotMatch(text,/post:link:register/);
 assert.doesNotMatch(text,/post:link:cancel/);
 assert.match(text,/https:\/\/example\.com\//);
 assert.match(text,/"style":"primary"/);
 assert.match(text,/"type":"photo"/);
});
test("④ right and down row positions, in-body delete controls",()=>{
 const placement=serialized(linkRichPlacement(draft,33));
 assert.match(placement,/post:link:delete:33:0/);
 assert.match(placement,/post:link:delete:33:2/);
 assert.match(placement,/post:link:beside:33:0/);
 assert.match(placement,/post:link:beside:33:1/);
 assert.match(placement,/post:link:add:33/);
 const added=parseLinkButtonPair("新規\nhttps://example.edu/");
 const right=insertLinkButton(draft,added,{kind:"right",rowIndex:0});
 assert.deepEqual(buttonGrid({...draft,buttons:right}).map(r=>r.map(b=>b.label)),[
  ["サイト１","サイト２","新規"],["サイト３"],
 ]);
 const below=insertLinkButton(draft,added,{kind:"newRow"});
 assert.deepEqual(buttonGrid({...draft,buttons:below}).map(r=>r.map(b=>b.label)),[
  ["サイト１","サイト２"],["サイト３"],["新規"],
 ]);
});
test("⑤ selected target only, keeps other field and buttons",()=>{
 const before=JSON.stringify(draft);
 const rich=serialized(linkRichContentEditor(draft,77,"b1"));
 assert.match(rich,/post:link:field:77:text/);
 assert.match(rich,/post:link:field:77:media/);
 assert.match(rich,/post:link:field:77:b1/);
 assert.match(rich,/✅/);
 assert.equal(JSON.stringify(draft),before);
});
test("registered code has native copy_text in Rich body and no dead callback",()=>{
 const text=serialized(linkRichPreview(draft,101,"abc123"));
 assert.match(text,/"copy_text":/);
 assert.match(text,/@GayBBS_bot abc123/);
 assert.doesNotMatch(text,/post:link:copy/);
});
