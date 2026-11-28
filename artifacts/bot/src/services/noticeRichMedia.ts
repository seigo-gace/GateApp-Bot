/** Native stickers have no Rich block. Attach a converted image to the SAME
 * Rich editor; never send a separate sticker, or expose a token-bearing URL. */
import type {Telegram} from "telegraf";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {noticeMedia,buildNoticeRichPreview,type NoticeDraft} from "./noticeEditor.js";
const run=promisify(execFile),MAX_BYTES=2*1024*1024;
export async function stickerPreviewImage(bytes:Buffer):Promise<{source:Buffer;filename:string}>{
 if(!bytes.length||bytes.length>MAX_BYTES)throw Error("NOTICE_STICKER_IMAGE_SIZE");
 if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return {source:bytes,filename:"sticker.jpg"};
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {source:bytes,filename:"sticker.png"};
 if(bytes.toString("ascii",0,4)!=="RIFF"||bytes.toString("ascii",8,12)!=="WEBP")throw Error("NOTICE_STICKER_THUMBNAIL_REQUIRED");
 const dir=await mkdtemp(join(tmpdir(),"gace-notice-"));
 try{
  const input=join(dir,"input.webp"),output=join(dir,"preview.png");
  await writeFile(input,bytes,{mode:0o600});
  await run("/usr/bin/dwebp",[input,"-o",output],{timeout:10000,maxBuffer:65536});
  const result=await readFile(output);
  if(!result.length||result.length>MAX_BYTES)throw Error("NOTICE_STICKER_IMAGE_SIZE");
  return {source:result,filename:"sticker.png"};
 }finally{await rm(dir,{recursive:true,force:true});}
}
async function downloadStickerImage(t:Telegram,id:string){
 const url=await t.getFileLink(id);
 if(url.protocol!=="https:"||url.hostname!=="api.telegram.org")throw Error("NOTICE_STICKER_FILE_ORIGIN");
 const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(15000)});
 if(!response.ok||Number(response.headers.get("content-length")||0)>MAX_BYTES)throw Error("NOTICE_STICKER_DOWNLOAD_FAILED");
 const reader=response.body?.getReader();
 if(!reader)throw Error("NOTICE_STICKER_DOWNLOAD_FAILED");
 const chunks:Buffer[]=[];let total=0;
 try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;
 if(total>MAX_BYTES)throw Error("NOTICE_STICKER_IMAGE_SIZE");chunks.push(Buffer.from(part.value));}}
 finally{await reader.cancel().catch(()=>{});}
 return stickerPreviewImage(Buffer.concat(chunks));
}
export async function prepareNoticeRich(t:Telegram,data:NoticeDraft,revision:number,error?:string,withStickers=true){
 const photos=new Map<number,string>(),files:Record<string,{source:Buffer;filename:string}>={};
 let failed=false;
 for(const [i,m] of noticeMedia(data).entries()){
  if(m.kind!=="sticker")continue;
  if(!withStickers){failed=true;continue;}
  try{
   const file=await downloadStickerImage(t,m.animated&&m.thumbnailId?m.thumbnailId:m.fileId);
   const name="notice_sticker_"+i;files[name]=file;photos.set(i,"attach://"+name);
  }catch{failed=true;}
 }
 const warning=failed?"ステッカーの画像プレビューを確認できません。素材は保持しています。必要なら再登録してください。":"";
 const rich=buildNoticeRichPreview(data,revision,photos,[error,warning].filter(Boolean).join("\n")||undefined);
 // Telegraf multipart supports top-level InputFile fields and JSON strings.
 return {payload:Object.keys(files).length?{rich_message:JSON.stringify(rich),...files}:{rich_message:rich},ready:!failed};
}
