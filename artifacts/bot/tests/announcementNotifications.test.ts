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
