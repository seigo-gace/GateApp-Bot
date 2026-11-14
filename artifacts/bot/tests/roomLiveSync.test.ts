import test from "node:test";
import assert from "node:assert/strict";
import {roomBadge} from "../src/services/roomPostStatus.js";
import {roomPublicationEditor,type RoomPublication} from "../src/services/roomPublishedEditor.js";

const base:RoomPublication={
 announcementId:1,roomId:2,roomRevision:3,groupTitle:"エリア’s BBS",
 topicTitle:"ビデオチャット",chatId:-1002373696859,messageId:100,
 title:"テストRoom",description:"説明",status:"scheduled",
 visibility:"public",scheduledAt:null,ownerJoinUrl:"https://meet.jit.si/example",
 destinations:[],
};
test("host Room start action is paired with LIVE room entry, and finish removes join",()=>{
 const scheduled=roomPublicationEditor(base);
 const start=scheduled.keyboard.reply_markup.inline_keyboard.flat();
 assert(start.some(b=>"callback_data" in b&&String(b.callback_data).includes(":start:")));
 assert(!start.some(b=>"url" in b&&b.url===base.ownerJoinUrl));
 const live=roomPublicationEditor({...base,status:"live"});
 assert.match(live.text,/🔴 LIVE中/);
 const liveButtons=live.keyboard.reply_markup.inline_keyboard.flat();
 assert(liveButtons.some(b=>"callback_data" in b&&String(b.callback_data).includes(":finish:")),
  "LIVE room must allow the owner to finish");
 assert(!liveButtons.some(b=>"url" in b&&b.url===base.ownerJoinUrl),
  "live UI must not expose the private meeting URL; only the authorized join flow may reveal it");
 const finished=roomPublicationEditor({...base,status:"finished"});
 assert.match(finished.text,/✅ 終了/);
 assert(!finished.keyboard.reply_markup.inline_keyboard.flat().some(b=>
  "url" in b&&b.url===base.ownerJoinUrl));
 assert.equal(roomBadge("finished"),"✅ 終了");
});
