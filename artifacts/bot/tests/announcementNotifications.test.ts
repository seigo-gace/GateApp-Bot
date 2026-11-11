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

test("application and room notices never require user slash commands",()=>{
 for(const action of ["submitted","accepted","held","declined","cancelled","started","visibility_changed"]){
  const result=renderAnnouncementNotification({action,applicationId:2,roomId:3});
  assert.doesNotMatch(result,/\/(?:applications|myapplications|joinrooms|myrooms)\b/);
 }
});
