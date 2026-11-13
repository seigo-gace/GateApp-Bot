import test from "node:test";
import assert from "node:assert/strict";
import {
 createJitsiJoinUrl,assertHttpsMeetingUrl,validateRoom,buildRoomCard,parseRoomDetails,
 validateAnnouncement,buildAnnouncementCard,
} from "../src/services/postingDomain.js";

test("Jitsi room URL is unpredictable and valid",()=>{
 const a=createJitsiJoinUrl(),b=createJitsiJoinUrl();
 assert.notEqual(a,b);
 assert.match(a,/^https:\/\/meet\.ffmuc\.net\/GayBBS-[a-f0-9]{32}$/);
});
test("new Jitsi rooms can use a verified anonymous meeting origin",()=>{
 const url=createJitsiJoinUrl("https://jitsi.example.org");
 assert.match(url,/^https:\/\/jitsi\.example\.org\/GayBBS-[a-f0-9]{32}$/);
 for(const invalid of ["http://jitsi.example.org","https://localhost",
   "https://jitsi.example.org/room","https://user:secret@jitsi.example.org",
   "https://jitsi.example.org/?x=1"])
  assert.throws(()=>createJitsiJoinUrl(invalid));
});

test("unsafe meeting URL schemes/hosts and credentials are refused",()=>{
 for(const u of ["javascript:alert(1)","http://meet.example/x","https://localhost/a",
  "https://127.0.0.1/x","https://10.1.2.3/x","https://user:pass@example.org/x"]){
  assert.throws(()=>assertHttpsMeetingUrl(u));
 }
 assert.equal(assertHttpsMeetingUrl("https://meet.example/room"),"https://meet.example/room");
});
test("ROOM card has no automatic join URL and escapes HTML",()=>{
 const draft=validateRoom({ownerId:42,name:"<Room>&",mode:"jitsi",status:"ready"});
 const out=buildRoomCard(draft,createJitsiJoinUrl());
 assert.ok(out.includes("&lt;Room&gt;&amp;"));
 assert.ok(!out.includes("meet.jit.si"));
});
test("announcement text escapes HTML and types remain distinct",()=>{
 const out=buildAnnouncementCard({ownerId:42,kind:"announcement",text:"<b>test</b>"});
 assert.ok(out.includes("&lt;b&gt;test&lt;/b&gt;"));
 assert.throws(()=>validateAnnouncement({ownerId:42,kind:"preview",text:"告知"}));
 assert.throws(()=>validateAnnouncement({ownerId:42,kind:"announcement",text:"知らせ",capacity:1}));
 assert.equal(validateAnnouncement({ownerId:42,kind:"recruitment",text:"参加者",capacity:3,purposeCodes:["サシ"],placeCodes:["場所あり","足あり"]}).capacity,3);
 assert.throws(()=>validateAnnouncement({ownerId:42,kind:"recruitment",text:"参加者",purposeCodes:[]}));
});

test("ROOM detail editing accepts a title with no optional description",()=>{
 assert.deepEqual(parseRoomDetails("ROOMタイトル"),{title:"ROOMタイトル",description:""});
 assert.deepEqual(parseRoomDetails("ROOMタイトル\n"),{title:"ROOMタイトル",description:""});
 assert.deepEqual(parseRoomDetails("ROOMタイトル\n説明"),{title:"ROOMタイトル",description:"説明"});
 assert.throws(()=>parseRoomDetails(""));
 assert.throws(()=>parseRoomDetails("T".repeat(101)));
});
