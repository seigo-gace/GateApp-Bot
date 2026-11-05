import test from "node:test";
import assert from "node:assert/strict";
import {showWizardScreen,removeUserWizardInput} from "../src/services/dmWizardScreen.js";

function telegramFixture() {
 const calls:Array<{kind:string;chatId:number;messageId?:number;text?:string}>=[];
 let failEdit=false, failDelete=false;
 const telegram={
  editMessageText:async (chatId:number,messageId:number,_inline:undefined,text:string)=>{
   calls.push({kind:"edit",chatId,messageId,text});
   if(failEdit)throw Error("MESSAGE_EDIT_REJECTED");
   return true;
  },
  sendMessage:async (chatId:number,text:string)=>{
   calls.push({kind:"send",chatId,text});
   return {message_id:200};
  },
  deleteMessage:async (chatId:number,messageId:number)=>{
   calls.push({kind:"delete",chatId,messageId});
   if(failDelete)throw Error("DELETE_DENIED");
   return true;
  },
 };
 return {telegram:telegram as any,calls,editFails(){failEdit=true;},deleteFails(){failDelete=true;}};
}

test("wizard replaces its Bot-owned private screen, not a public posting",async()=>{
 const f=telegramFixture();
 const r=await showWizardScreen(f.telegram,12345,99,"new step");
 assert.deepEqual(r,{messageId:99,replaced:true});
 assert.deepEqual(f.calls.map(x=>x.kind),["edit"]);
 await assert.rejects(showWizardScreen(f.telegram,-100123456,99,"group"),/PRIVATE/);
 assert.equal(f.calls.length,1);
});

test("edit rejection creates one fallback screen and attempts old-screen deletion",async()=>{
 const f=telegramFixture();
 f.editFails();
 const r=await showWizardScreen(f.telegram,12345,99,"next step");
 assert.deepEqual(r,{messageId:200,replaced:false});
 assert.deepEqual(f.calls.map(x=>x.kind),["edit","send","delete"]);
});

test("user-sent DM input is removed on success or a warning can be shown",async()=>{
 const f=telegramFixture();
 assert.equal(await removeUserWizardInput(f.telegram,12345,81),true);
 f.deleteFails();
 assert.equal(await removeUserWizardInput(f.telegram,12345,82),false);
 await assert.rejects(removeUserWizardInput(f.telegram,-100123456,83),/PRIVATE/);
 assert.deepEqual(f.calls.filter(x=>x.kind==="delete").map(x=>x.messageId),[81,82]);
});

test("new screen does not delete anything without a confirmed previous ID",async()=>{
 const f=telegramFixture();
 const r=await showWizardScreen(f.telegram,12345,undefined,"first");
 assert.equal(r.messageId,200);
 assert.deepEqual(f.calls.map(x=>x.kind),["send"]);
});
