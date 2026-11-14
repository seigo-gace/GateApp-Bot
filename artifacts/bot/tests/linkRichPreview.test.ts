import test from "node:test";
import assert from "node:assert/strict";
import {linkRichPreview} from "../src/services/linkRichPreview.js";
import type {LinkDraft} from "../src/services/linkButtonDomain.js";
const buttons=[
 {label:"A",url:"https://example.org/a",rowStart:true,style:"primary" as const},
 {label:"B",url:"https://example.org/b",rowStart:false,style:"success" as const},
 {label:"C",url:"https://example.org/c",rowStart:true},
];
for(const media of [undefined,{type:"photo" as const,fileId:"cached-photo"},{type:"video" as const,fileId:"cached-video"}]){
 test("Rich preview media + editor and final buttons "+(media?.type??"text"),()=>{
  const draft:LinkDraft={text:media?"説明":"文章",buttons,columns:1,...(media?{media}:{})};
  const blocks=linkRichPreview(draft,7).blocks;
  const editParagraph=blocks.filter(x=>x.type==="paragraph"&&Array.isArray(x.text)&&
   x.text.some((v:unknown)=>typeof v==="object"&&v!==null&&
    (v as {type?:string}).type==="button"));
  assert.equal(editParagraph.length,3);
  const editCommands=editParagraph.map(x=>
   (x.text as Array<{button?:{callback_data?:string}}>)
   .find(v=>v.button)?.button?.callback_data);
  assert.deepEqual(editCommands,["post:link:edittext:7","post:link:editmedia:7","post:link:panel:7"]);
  assert.deepEqual(blocks.filter(x=>x.type==="buttons")
   .map(x=>(x.buttons as Array<{text:string}>).map(b=>b.text)),[["A","B"],["C"]]);
  assert.equal(blocks.some(x=>x.type===media?.type),Boolean(media));
 });
}
test("Registered code must appear before preview and be copyable",()=>{
 const d:LinkDraft={text:"本文",buttons,columns:1};
 const blocks=linkRichPreview(d,6,"ABCDEFGHIJKLMNOPQRSTUVWX").blocks;
 assert.match(JSON.stringify(blocks[0]),/@GayBBS_bot ABCDEFGHIJKLMNOPQRSTUVWX/);
 assert.match(JSON.stringify(blocks[1]),/"copy_text"/);
});
