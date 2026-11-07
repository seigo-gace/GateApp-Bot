import test from "node:test";
import assert from "node:assert/strict";
import {publishOnlineRoomCards,type OnlinePhotoReceipt,type OnlinePhotoStore} from "../src/services/onlineRoomPublisher.js";
const links=[
 {group:"area_bbs" as const,gateStartUrl:"https://t.me/ExistingGateBot?start=a_abc",verified:true},
 {group:"video_chat" as const,gateStartUrl:"https://t.me/ExistingGateBot?start=v_def",verified:true},
 {group:"gay_board" as const,gateStartUrl:"https://t.me/ExistingGateBot?start=g_ghi",verified:true},
];
const target={chatId:-1003847210571,threadId:123};
function setup(failAt=0,existing:OnlinePhotoReceipt[]=[]){
 let sends=0,claimed=0,finished=0,reconciled=0;
 const records:OnlinePhotoReceipt[]=[];
 const store:OnlinePhotoStore={
  async claim(){claimed++;return {setId:1,existing};},
  async record(_id,receipt){records.push(receipt);},
  async finish(){finished++;},
  async reconcile(){reconciled++;},
 };
 const deps={
  async getAsset(id:string){return {bytes:Buffer.from("fake verified media"),mimeType:id==="1KZgfk8WlkUnFBbuLxQ5-fjezYO7oFCZu"?"image/png" as const:"image/jpeg" as const,width:1080,height:1080,verifiedDriveFileId:id};},
  async send(){sends++;if(sends===failAt)throw new Error("TELEGRAM_API_UNCERTAIN");return 100+sends;},
  store,
 };
 return {deps,state:()=>({sends,claimed,finished,reconciled,records})};
}
test("four ONLINE cards are sent exactly once in order and receipts persisted",async()=>{
 const x=setup();
 const result=await publishOnlineRoomCards(target,links,x.deps);
 assert.deepEqual(result.map(x=>x.key),["intro","area_bbs","video_chat","gay_board"]);
 assert.deepEqual(x.state(),{sends:4,claimed:1,finished:1,reconciled:0,records:result});
});
test("uncertain third send records first two and fails closed without retry",async()=>{
 const x=setup(3);
 await assert.rejects(publishOnlineRoomCards(target,links,x.deps),/TELEGRAM_API_UNCERTAIN/);
 assert.equal(x.state().sends,3);
 assert.equal(x.state().records.length,2);
 assert.equal(x.state().reconciled,1);
 assert.equal(x.state().finished,0);
});
test("existing partial receipts prevent any new Telegram send",async()=>{
 const x=setup(0,[{key:"intro",messageId:321}]);
 await assert.rejects(publishOnlineRoomCards(target,links,x.deps),/EXISTING_RECEIPTS_RECONCILE/);
 assert.equal(x.state().sends,0);
 assert.equal(x.state().reconciled,1);
});
test("invalid GATE links or target prevent any media publication",async()=>{
 const x=setup();
 await assert.rejects(publishOnlineRoomCards({...target,chatId:-1002373696859},links,x.deps),/TOPIC_UNVERIFIED/);
 await assert.rejects(publishOnlineRoomCards(target,links.slice(0,2),x.deps),/LINKS_INCOMPLETE/);
 assert.equal(x.state().claimed,0);
});
