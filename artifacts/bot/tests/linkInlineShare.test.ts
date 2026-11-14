import test from "node:test";
import assert from "node:assert/strict";
import {linkInlineResult} from "../src/services/linkInlineShare.js";
import type {LinkDraft} from "../src/services/linkButtonDomain.js";

function post(draft:LinkDraft){
 return {ownerId:123,sourceId:"45",draft};
}
const buttons=[
 {label:"ニュース",url:"https://example.org/news",rowStart:true,style:"primary" as const},
 {label:"参加",url:"https://example.org/join",rowStart:false,style:"success" as const},
 {label:"注意",url:"https://example.org/help",rowStart:true,style:"danger" as const},
];
for(const [name,media,text] of [
 ["text",undefined,"本文のみ"],
 ["photo",{"type":"photo" as const,fileId:"file-photo"},""],
 ["photo caption",{"type":"photo" as const,fileId:"file-photo"},"画像コメント"],
 ["video",{"type":"video" as const,fileId:"file-video"},""],
 ["video caption",{"type":"video" as const,fileId:"file-video"},"動画コメント"],
] as const){
 test("PostBot inline candidate: "+name,()=>{
  const draft:LinkDraft={text,buttons,columns:1,captionAbove:true,...(media?{media}:{})};
  const result=linkInlineResult(post(draft));
  const keyboard=(result.reply_markup as {inline_keyboard:Array<Array<{text:string;url:string;style:string}>>}).inline_keyboard;
  assert.deepEqual(keyboard.map(row=>row.map(b=>b.text)),[["ニュース","参加"],["注意"]]);
  assert.deepEqual(keyboard.map(row=>row.map(b=>b.style)),[["primary","success"],["danger"]]);
  assert.equal(result.type,media?media.type:"article");
  if(media){
   assert.equal(result[media.type==="photo"?"photo_file_id":"video_file_id"],media.fileId);
   assert.equal(result.caption,text);
   assert.equal(result.show_caption_above_media,true);
  }else{
   assert.deepEqual(result.input_message_content,{message_text:text});
  }
 });
}
