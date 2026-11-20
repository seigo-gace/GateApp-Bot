import test from "node:test";
import assert from "node:assert/strict";
import {linkRichPreview,linkRichPublication,linkRichPlacement,linkRichContentEditor} from "../src/services/linkRichPreview.js";
import {linkInlineResult,type LinkInlinePost} from "../src/services/linkInlineShare.js";
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
test("registered code is selectable text without unsupported Rich copy_text",()=>{
 const text=serialized(linkRichPreview(draft,101,"abc123"));
 assert.doesNotMatch(text,/"copy_text":/);
 assert.match(text,/@GayBBS_bot abc123/);
 assert.doesNotMatch(text,/post:link:copy/);
});

test("public Rich post and preview use exactly the same material and URL button blocks",()=>{
 const result=linkInlineResult({ownerId:42,sourceId:"10",draft} as LinkInlinePost);
 assert.equal(result.type,"article");
 const embedded=(result.input_message_content as {rich_message:ReturnType<typeof linkRichPublication>}).rich_message;
 const publicBlocks=linkRichPublication(draft).blocks;
 assert.deepEqual(embedded.blocks,publicBlocks);
 const privateBlocks=linkRichPreview(draft,9).blocks;
 assert.deepEqual(privateBlocks.slice(0,publicBlocks.length),publicBlocks);
 assert.equal(JSON.stringify(publicBlocks).includes("post:link:panel"),false);
 assert.equal(JSON.stringify(publicBlocks).includes("post:link:register"),false);
});

test("mixed image/video content and per-media captions are exactly preserved in the inline Rich result",()=>{
 const mixed:LinkDraft={...draft,mediaExtras:[
  {type:"video",fileId:"video_file_ref",caption:"動画の補足"},
  {type:"photo",fileId:"another_photo_ref",caption:"画像の補足"},
 ]};
 const published=linkRichPublication(mixed);
 const types=published.blocks.map(x=>x.type);
 assert.deepEqual(types.filter(x=>x==="photo"||x==="video"),["photo","video","photo"]);
 const inline=linkInlineResult({ownerId:42,sourceId:"12",draft:mixed});
 assert.deepEqual((inline.input_message_content as {rich_message:typeof published}).rich_message,published);
 assert.match(JSON.stringify(published),/動画の補足/);
 assert.match(JSON.stringify(published),/画像の補足/);
});

test("Bot launch subscribes to inline_query updates for registered link codes",async()=>{
 const {readFileSync}=await import("node:fs");
 const {resolve}=await import("node:path");
 const source=readFileSync(resolve(process.cwd(),"src/gaybbsBot.ts"),"utf8");
 assert.match(source,/allowedUpdates:\s*\[[^\]]*"inline_query"/);
});
