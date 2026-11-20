import test from "node:test";
import assert from "node:assert/strict";
import {linkRichPreview,linkRichPublication,linkRichPlacement,linkRichContentEditor,linkUrlKeyboardRows,linkRichRegisteredReceipt} from "../src/services/linkRichPreview.js";
import {linkInlineResult,type LinkInlinePost} from "../src/services/linkInlineShare.js";
import {insertLinkButton,buttonGrid,parseLinkButtonPair,validateLinkDraft,type LinkDraft} from "../src/services/linkButtonDomain.js";

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
 assert.doesNotMatch(text,/https:\/\/example\.com\//);
 assert.deepEqual(linkUrlKeyboardRows(draft).map(r=>r.map(b=>b.text)),[["サイト１","サイト２"],["サイト３"]]);
 assert.match(serialized(linkUrlKeyboardRows(draft)),/"style":"primary"/);
 assert.match(text,/"type":"photo"/);
});
test("④ right and down row positions, in-body delete controls",()=>{
 const placement=serialized(linkRichPlacement(draft,33));
 assert.match(placement,/post:link:delete:33:0/);
 assert.match(placement,/post:link:delete:33:2/);
 assert.match(placement,/post:link:beside:33:0/);
 assert.match(placement,/post:link:beside:33:1/);
 assert.match(placement,/post:link:add:33/);
 assert.match(placement,/"text":"➡️"/);
 assert.match(placement,/"text":"⬇️"/);
 assert.doesNotMatch(placement,/［▶］|［▼］|▶️|🔽/);
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
test("arbitrary URL layout length is not capped at four by application code",()=>{
 let all:LinkDraft={...draft,buttons:[{label:"A",url:"https://example.org/",rowStart:true}]};
 for(let i=0;i<6;i++)all={...all,buttons:insertLinkButton(all,
  {label:"B"+i,url:"https://example.org/"},{kind:"right",rowIndex:0})};
 assert.equal(buttonGrid(all)[0]?.length,7);
 assert.equal(linkUrlKeyboardRows(all)[0]?.length,7);
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
test("registered receipt is separate from editable publication and preserves code",()=>{
 const code="ABCDEFGHIJKLMNOPQRSTUVWX";
 const view=linkRichRegisteredReceipt(code);
 const text=serialized(view);
 assert.match(text,/登録コード/);
 assert.match(text,/投稿する方法/);
 assert.match(text,new RegExp(code));
 assert.doesNotMatch(text,/post:link:register/);
 assert.doesNotMatch(text,/post:link:panel/);
 assert.equal(view.blocks.some(b=>b.type==="buttons"),false);
});

test("registered code is selectable text without unsupported Rich copy_text",()=>{
 const text=serialized(linkRichPreview(draft,101,"abc123"));
 assert.doesNotMatch(text,/"copy_text":/);
 assert.match(text,/@GayBBS_bot abc123/);
 assert.doesNotMatch(text,/post:link:copy/);
});

test("public Rich post and preview share media body, real URL rows live in reply markup",()=>{
 const result=linkInlineResult({ownerId:42,sourceId:"10",draft} as LinkInlinePost);
 assert.equal(result.type,"article");
 const embedded=(result.input_message_content as {rich_message:ReturnType<typeof linkRichPublication>}).rich_message;
 const publicBlocks=linkRichPublication(draft).blocks;
 assert.deepEqual(embedded.blocks,publicBlocks);
 assert.deepEqual((result.reply_markup as {inline_keyboard:unknown}).inline_keyboard,linkUrlKeyboardRows(draft));
 assert.equal(publicBlocks.some(block=>block.type==="buttons"),false);
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

test("MP4 received as document preserves its actual Telegram media type in preview and shared post",()=>{
 const mp4:LinkDraft={...draft,text:"",media:{
  type:"document",fileId:"mp4_document_file_id",caption:"動画の補足",
 }};
 const preview=linkRichPreview(mp4,41).blocks;
 const publicBlocks=linkRichPublication(mp4).blocks;
 const block=publicBlocks.find(b=>b.type==="document");
 assert.deepEqual(block,{
  type:"document",document:{type:"document",media:"mp4_document_file_id"},
  caption:{text:"動画の補足"},
 });
 assert.deepEqual(preview.slice(0,publicBlocks.length),publicBlocks);
 const result=linkInlineResult({ownerId:42,sourceId:"mp4",draft:mp4});
 assert.deepEqual((result.input_message_content as {rich_message:{blocks:unknown}}).rich_message.blocks,
  publicBlocks);
 assert.deepEqual((result.reply_markup as {inline_keyboard:unknown}).inline_keyboard,
  linkUrlKeyboardRows(mp4));
 assert.match(JSON.stringify(linkRichContentEditor(mp4,42)),/動画ファイル/);
});

test("Bot launch subscribes to inline_query updates for registered link codes",async()=>{
 const {readFileSync}=await import("node:fs");
 const {resolve}=await import("node:path");
 const source=readFileSync(resolve(process.cwd(),"src/gaybbsBot.ts"),"utf8");
 assert.match(source,/allowedUpdates:\s*\[[^\]]*"inline_query"/);
});

test("registered link receipt is not silently reused as a new draft",async()=>{
 const {readFileSync}=await import("node:fs");
 const {resolve}=await import("node:path");
 const source=readFileSync(resolve(process.cwd(),"src/bot/postingHandlers.ts"),"utf8");
 const start=source.indexOf("export async function startLinkEditor(");
 const end=source.indexOf("/** One shared Bot DM message for the approved 告知/予告 layout.",start);
 assert.ok(start>=0&&end>start);
 const editor=source.slice(start,end);
 assert.match(editor,/typeof prior\.data\.shareCode!=="string"/);
 assert.match(editor,/reusable\?\.step==="preview"/);
 assert.match(editor,/beginDraft\(userId,"link","awaiting_text"/);
});

test("first photo caption remains a media caption and not a duplicate body paragraph",()=>{
 const withCaption:LinkDraft={...draft,text:"",media:{
  type:"photo",fileId:"photo_file_id",caption:"画像の補足"
 },mediaExtras:[{type:"video",fileId:"video_file_id",caption:"動画の補足"}]};
 const published=linkRichPublication(withCaption);
 const photo=published.blocks.find(b=>b.type==="photo") as Record<string,unknown>;
 const video=published.blocks.find(b=>b.type==="video") as Record<string,unknown>;
 assert.deepEqual(photo.caption,{text:"画像の補足"});
 assert.deepEqual(video.caption,{text:"動画の補足"});
 assert.equal(published.blocks.some(b=>b.type==="paragraph" &&
  JSON.stringify(b).includes("画像の補足")),false);
 const result=linkInlineResult({ownerId:3,sourceId:"caption-1",draft:withCaption});
 assert.deepEqual((result.input_message_content as {rich_message:typeof published}).rich_message,published);
});


test("malformed persisted media arrays fail safely before Rich rendering",()=>{
 const malformed={...draft,mediaExtras:{bad:"not-an-array"}} as unknown as LinkDraft;
 assert.throws(()=>validateLinkDraft(malformed),/LINK_MEDIA_ALBUM_INVALID/);
 assert.throws(()=>linkRichPublication(malformed),/LINK_MEDIA_ALBUM_INVALID/);
 const detached={...draft,media:undefined,mediaExtras:[{type:"photo",fileId:"x"}]} as LinkDraft;
 assert.throws(()=>validateLinkDraft(detached),/LINK_MEDIA_ALBUM_INVALID/);
});


test("native cached sticker URL delivery retains original Telegram sticker ID and button rows",()=>{
 const original=JSON.stringify(draft);
 for(const format of ["WebP","WebM","TGS"]){
  const sticker:LinkDraft={...draft,text:"",media:{type:"sticker",fileId:"telegram_sticker_"+format}};
  const result=linkInlineResult({ownerId:42,sourceId:format,draft:sticker});
  assert.equal(result.type,"sticker");
  assert.equal(result.sticker_file_id,"telegram_sticker_"+format);
  assert.equal("input_message_content" in result,false);
  assert.deepEqual((result.reply_markup as {inline_keyboard:unknown}).inline_keyboard,linkUrlKeyboardRows(sticker));
  assert.throws(()=>linkRichPublication(sticker),/LINK_STICKER_USE_NATIVE_MESSAGE/);
 }
 assert.equal(JSON.stringify(draft),original);
});
test("sticker cannot silently lose body, caption, or secondary media",()=>{
 const sticker={...draft,media:{type:"sticker" as const,fileId:"sticker-id"},text:""};
 assert.throws(()=>validateLinkDraft({...sticker,text:"post body"}),/LINK_STICKER_RICH_COMPOSITION_UNSUPPORTED/);
 assert.throws(()=>validateLinkDraft({...sticker,media:{...sticker.media,caption:"caption"}}),/LINK_STICKER_RICH_COMPOSITION_UNSUPPORTED/);
 assert.throws(()=>validateLinkDraft({...sticker,mediaExtras:[{type:"photo",fileId:"another"}]}),/LINK_STICKER_RICH_COMPOSITION_UNSUPPORTED/);
});
