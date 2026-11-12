import test from "node:test";
import assert from "node:assert/strict";
import {shouldPurgeAnnouncement} from "../src/services/announcementPurge.js";
const now=new Date("2026-11-05T12:00:00Z");
test("discard standalone closed/cancelled/finished announcements",()=>{
 for(const status of ["closed","cancelled","finished"]){
  assert.equal(shouldPurgeAnnouncement(status,false,null,now),true);
 }
});
test("expire standalone content but do not delete still active content without expiry",()=>{
 assert.equal(shouldPurgeAnnouncement("published",false,
  new Date("2026-11-05T11:59:00Z"),now),true);
 assert.equal(shouldPurgeAnnouncement("published",false,
  new Date("2026-11-05T12:01:00Z"),now),false);
 assert.equal(shouldPurgeAnnouncement("published",false,null,now),false);
 assert.equal(shouldPurgeAnnouncement("filled",false,null,now),false);
});
test("never sweep ROOM linked announcements: room purge owns them",()=>{
 assert.equal(shouldPurgeAnnouncement("finished",true,null,now),false);
 assert.equal(shouldPurgeAnnouncement("published",true,new Date(0),now),false);
});
