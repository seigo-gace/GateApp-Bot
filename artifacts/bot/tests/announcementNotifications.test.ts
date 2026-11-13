import test from "node:test";
import assert from "node:assert/strict";
import {renderAnnouncementNotification,roomApplicantNotificationKeyboard,normalizedApplicationId} from "../src/services/announcementNotifications.js";

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

test("Room owner application notification groups chat / accept / reject without singleton",()=>{
 const keyboard=roomApplicantNotificationKeyboard(123456,456,"Applicant_1");
 const rows=keyboard.reply_markup.inline_keyboard;
 assert.equal(rows.length,1);
 assert.equal(rows[0]?.length,3);
 assert.deepEqual(rows[0]?.map(x=>x.text),
  ["💬 応募者へDM","✅ 承諾","❌ 拒否"]);
 assert.equal("url" in rows[0]![0]! && rows[0]![0]!.url,
  "https://t.me/Applicant_1");
 assert.equal("callback_data" in rows[0]![1]! && rows[0]![1]!.callback_data,
  "application:decide:456:accepted");
 assert.equal("callback_data" in rows[0]![2]! && rows[0]![2]!.callback_data,
  "application:decide:456:declined");
 assert.equal("url" in roomApplicantNotificationKeyboard(123456,456).reply_markup.inline_keyboard[0]![0]!,
  true);
 assert.throws(()=>roomApplicantNotificationKeyboard(123456,0),/INVALID/);
});

test("postgres BIGSERIAL IDs preserved in JSON strings are accepted for existing owner notices",()=>{
 assert.equal(normalizedApplicationId("15"),15);
 assert.equal(normalizedApplicationId(15),15);
 assert.equal(normalizedApplicationId("00015"),null);
 for(const invalid of [null,undefined,"0",0,-1,"n/a","1; DROP TABLE",{},1.2,"9007199254740994"])
  assert.equal(normalizedApplicationId(invalid),null);
});

test("submitted owner notice includes the Room applicant-list action as well as approval controls",()=>{
 const rows=roomApplicantNotificationKeyboard(123456,456,undefined,15)
  .reply_markup.inline_keyboard;
 assert.equal(rows.length,2);
 assert.deepEqual(rows[0]?.map(x=>x.text),
  ["💬 応募者へDM","✅ 承諾","❌ 拒否"]);
 assert.equal(rows[1]?.[0]?.text,"👥 応募者を見る");
 assert.equal("callback_data" in rows[1]![0]!&&rows[1]![0]!.callback_data,
  "room:published:applicants:15");
});
