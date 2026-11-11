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

import {applicantDmLink} from "../src/services/telegramUsernameLink.js";
test("owner gets a direct applicant chat link with or without username",()=>{
 assert.equal(applicantDmLink(123456,"Applicant_1"),"https://t.me/Applicant_1");
 assert.equal(applicantDmLink(123456),"tg://user?id=123456");
 assert.equal(applicantDmLink(123456,"not a username"),"tg://user?id=123456");
 assert.throws(()=>applicantDmLink(-1),/APPLICANT_ID_INVALID/);
});
