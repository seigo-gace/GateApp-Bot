import test from "node:test";
import assert from "node:assert/strict";
import {renderAnnouncementNotification} from "../src/services/announcementNotifications.js";

test("only adopted notification actions; user content and meeting URL never copied",()=>{
 const inputs=["submitted","accepted","held","declined",
  "scheduled","prepared","started","postponed","cancelled","finished"];
 for(const action of inputs){
  const result=renderAnnouncementNotification({source:"room",kind:action,roomId:1});
  assert.ok(result.length>3);
  assert.ok(!result.includes("https://meet.jit.si/"));
 }
 assert.throws(()=>renderAnnouncementNotification({action:"<script>alert(1)</script>"}),/NOT_SUPPORTED/);
});

test("ROOM start applicant notification is once-only and never embeds a meeting URL",()=>{
 const approved=renderAnnouncementNotification({kind:"started",roomId:1,applicationStatus:"accepted"});
 const pending=renderAnnouncementNotification({kind:"started",roomId:1,applicationStatus:"submitted"});
 const held=renderAnnouncementNotification({kind:"started",roomId:1,applicationStatus:"held"});
 assert.match(approved,/\/joinrooms/);
 assert.match(pending,/承認待ち/);
 assert.match(held,/承認待ち/);
 for(const body of [approved,pending,held]){
  assert.doesNotMatch(body,/https?:\/\//);
 }
 assert.throws(()=>renderAnnouncementNotification({kind:"started",applicationStatus:"withdrawn"}),/INVALID/);
});
