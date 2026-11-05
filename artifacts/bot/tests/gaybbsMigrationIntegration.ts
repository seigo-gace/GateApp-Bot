/** Isolated PostgreSQL integration test: never connect to a production DB.
 * CI assigns temporary Postgres 16 and a dedicated test database.
 */
import assert from "node:assert/strict";
import {runMigrations} from "../src/db/migrate.js";
import {pool,closePool} from "../src/db/index.js";
import {submitApplication,decideApplication} from "../src/services/announcementApplications.js";
import {updateRoomState,changeRoomVisibility} from "../src/services/roomLifecycle.js";
import {projectNextRoomEvent} from "../src/services/announcementRoomEvents.js";
import {deliverNextAnnouncementNotification} from "../src/services/announcementNotifications.js";
import type {Telegram} from "telegraf";
import {getAuthorizedRoom,listAuthorizedRooms} from "../src/services/roomAccess.js";
import {createRoom,createAnnouncement,beginDraft,getDraft,updateDraft} from "../src/services/publicPostRepository.js";
import {purgeDisposableAnnouncements,purgeAbandonedDrafts} from "../src/services/announcementPurge.js";
import {roomStatusMessage,updateNextRoomStatusMessage} from "../src/services/roomPostStatus.js";
import {finalizeNextRoom} from "../src/services/roomTerminalFinalizer.js";
import {archiveNextTerminalAnnouncement} from "../src/services/announcementArchive.js";
import {currentDmTextOwner} from "../src/services/dmInputOwner.js";
import {activateMenuOrigin} from "../src/services/menuOriginRepository.js";
import {newMenuToken,tokenHash} from "../src/services/menuOrigin.js";
if(!process.env.DATABASE_URL?.endsWith("/gaybbs_test"))
 throw new Error("INTEGRATION_MUST_USE_GAYBBS_TEST_DB");

try{
 await runMigrations();
 await runMigrations(); // idempotency when a container is restarted.
 for(const table of ["profiles","profile_tags","profile_media","profile_publications",
  "posting_topics","posting_deliveries","public_post_drafts",
  "room_posts","announcement_posts","announcement_applications",
  "announcement_notifications","announcement_application_entries",
  "announcement_room_dispatches","room_source_events","room_host_sessions",
  "link_button_posts","general_guide_topics","general_guide_documents",
  "board_menu_panels","board_menu_entry_tokens","gaybbs_feature_release_gates"]){
  const found=await pool.query("SELECT to_regclass($1)::text AS reg",[table]);
  assert.ok(found.rows[0]?.reg,table);
 }
 // A06: field data and consented profile summary belong to one announcement
 // source; no new profile record or redundant database is created.
 const manual=await createAnnouncement(811001,11,"recruitment","本文1行\n本文2行",
  undefined,["サシ"],["場所なし"],undefined,{
   conditions:{inputMode:"manual",title:"募集タイトル",nickname:"ゼロ",
    heightCm:175,weightKg:80,age:40,position:"タチ"},
  });
 const linkedRecruit=await createAnnouncement(811002,12,"recruitment","別の募集文",
  undefined,["飲み/飯"],[],undefined,{
   conditions:{inputMode:"linked",title:"食事募集"},
   profileSnapshot:{nickname:"テスト",heightCm:170,weightKg:70,age:35,position:"リバ"},
  });
 const savedManual=await pool.query(
  "SELECT text,conditions,profile_snapshot FROM announcement_posts WHERE announcement_id=$1",
  [manual.sourceId]);
 assert.equal(savedManual.rows[0].text,"本文1行\n本文2行");
 assert.equal(savedManual.rows[0].conditions.title,"募集タイトル");
 assert.equal(savedManual.rows[0].conditions.position,"タチ");
 assert.equal(savedManual.rows[0].profile_snapshot,null);
 const savedLinked=await pool.query(
  "SELECT conditions,profile_snapshot FROM announcement_posts WHERE announcement_id=$1",
  [linkedRecruit.sourceId]);
 assert.equal(savedLinked.rows[0].conditions.title,"食事募集");
 assert.equal(savedLinked.rows[0].profile_snapshot.nickname,"テスト");
 // Reopening after cancellation gets a new revision and no old private fields.
 // A06: an r_ entry is authenticated against the same existing announcement
 // token ledger; a profile token must never masquerade as recruitment.
 const panel=await pool.query(
  `INSERT INTO board_menu_panels
    (chat_id,message_thread_id,panel_type,state,verified_by,verified_at)
   VALUES(-1003847210571,712345,'posting','published',811001,NOW())
   RETURNING panel_id`);
 const panelId=Number(panel.rows[0].panel_id);
 const recruitToken=newMenuToken(),profileToken=newMenuToken();
 await pool.query(
  `INSERT INTO board_menu_entry_tokens(token_hash,panel_id,feature,expires_at)
   VALUES($1,$3,'announcement',NOW()+INTERVAL '1 day'),
         ($2,$3,'profile',NOW()+INTERVAL '1 day')`,
  [tokenHash(recruitToken),tokenHash(profileToken),panelId]);
 const recruitingOrigin=await activateMenuOrigin(811004,"r_"+recruitToken);
 assert.equal(recruitingOrigin.feature,"announcement");
 assert.equal(recruitingOrigin.threadId,712345);
 await assert.rejects(()=>activateMenuOrigin(811004,"r_"+profileToken),
  /RECRUITMENT_MENU_FEATURE_NOT_VERIFIED/);
 const first=await beginDraft(811003,"announcement","awaiting_text",
  {kind:"recruitment",recruitmentFlow:"compact",title:"キャンセル対象"});
 const cancelledRecruitment=await updateDraft(811003,"announcement",first.revision,"cancelled",
  {recruitmentFlow:"compact",cancelled:true});
 assert.equal(cancelledRecruitment.step,"cancelled");
 assert.notEqual(await currentDmTextOwner(811003),"announcement","cancelled draft must not capture DM input");
 assert.equal(cancelledRecruitment.data.title,undefined);
 const again=await beginDraft(811003,"announcement","awaiting_text",
  {kind:"recruitment",recruitmentFlow:"compact"});
 assert.ok(again.revision>cancelledRecruitment.revision);
 assert.equal((await getDraft(811003,"announcement"))?.data.title,undefined);
 const draft=await pool.query(
  `INSERT INTO announcement_posts
    (request_key,owner_user_id,kind,text,status,capacity,accept_applications)
   VALUES('db-int-1',111001,'recruitment','テスト募集','published',1,TRUE)
   RETURNING announcement_id`);
 const id=Number(draft.rows[0].announcement_id);
 const a=await submitApplication(id,222001,null);
 const b=await submitApplication(id,222002,null);
 assert.equal(a.duplicate,false);
 assert.equal((await submitApplication(id,222001,null)).duplicate,true);
 assert.equal(b.duplicate,false);
 const decisions=await Promise.allSettled([
  decideApplication(111001,id,a.applicationId,"accepted"),
  decideApplication(111001,id,b.applicationId,"accepted"),
 ]);
 assert.equal(decisions.filter(x=>x.status==="fulfilled").length,1,
  "capacity=1 concurrent decisions must commit one only");
 assert.equal(decisions.filter(x=>x.status==="rejected").length,1);
 const posts=await pool.query(
  "SELECT status,accept_applications FROM announcement_posts WHERE announcement_id=$1",[id]);
 assert.equal(posts.rows[0].status,"filled");
 assert.equal(posts.rows[0].accept_applications,false);
 const count=await pool.query(
  `SELECT count(*)::int AS n FROM announcement_applications
   WHERE announcement_id=$1 AND status='accepted'`,[id]);
 assert.equal(Number(count.rows[0].n),1);
 const notify=await pool.query(
  "SELECT count(*)::int AS n FROM announcement_notifications WHERE announcement_id=$1",[id]);
 assert.equal(Number(notify.rows[0].n),3,
  "two submitted notifications and one owner decision notification");
 // Integration: ROOM is state owner. Announcement receives immutable events
 // and queues a separate MPB edit; no raw join URL enters notification payload.
 const room=await pool.query(
  `INSERT INTO room_posts(request_key,owner_user_id,title,mode,join_url,status)
   VALUES('db-room-1',111001,'test room','jitsi','https://meet.jit.si/PRIVATE','ready')
   RETURNING room_id,revision`);
 const roomId=Number(room.rows[0].room_id);
 const linked=await pool.query(
  `INSERT INTO announcement_posts(request_key,owner_user_id,kind,text,status,room_id)
   VALUES('db-room-ann-1',111001,'announcement','ROOM案内','published',$1)
   RETURNING announcement_id`,[roomId]);
 const linkedId=Number(linked.rows[0].announcement_id);
 const deliveryTopic=await pool.query(
  `INSERT INTO posting_topics(board_key,purpose,chat_id,message_thread_id,
    title,verified_by,verified_at,enabled)
   VALUES('video_chat','announcement',-1002373696859,987,'Room purge test',111001,NOW(),TRUE)
   RETURNING topic_id`);
 await pool.query(
  `INSERT INTO posting_deliveries
   (source_type,source_id,owner_user_id,source_revision,posting_topic_id,
     operation_key,status,telegram_message_id,inline_buttons,rendered_text)
   VALUES('announcement',$1,111001,1,$2,'db-room-delivery','sent',87654,
     '[]'::jsonb,'🎬 <b>元の公開ROOM告知</b>・保持する詳細')`,
  [String(linkedId),deliveryTopic.rows[0].topic_id]);
 const source=await updateRoomState(111001,roomId,1,"start");
 assert.equal(source.state,"live");
 const consumed=await projectNextRoomEvent();
 assert.equal(consumed?.eventId,source.eventId);
 assert.deepEqual(consumed?.announcementIds,[linkedId]);
 assert.equal(await projectNextRoomEvent(),null);
 const once=await pool.query(
  `SELECT count(*)::int AS n FROM announcement_room_dispatches
   WHERE announcement_id=$1 AND room_event_id=$2`,[linkedId,source.eventId]);
 assert.equal(once.rows[0].n,1);
 const ownerNotice=await pool.query(
  `SELECT payload::text AS payload FROM announcement_notifications
   WHERE announcement_id=$1 AND event_key=$2`,
  [linkedId,"room-event:"+source.eventId+":owner:"+linkedId]);
 assert.equal(ownerNotice.rows.length,1);
 assert.ok(!ownerNotice.rows[0].payload.includes("meet.jit.si"));
 console.log("GAYBBS_DB_ROOM_ANNOUNCEMENT_OUTBOX=PASS");
 // Entirely disposable CI database; no feature gate is enabled in production.
 await pool.query(
  `INSERT INTO gaybbs_feature_release_gates
  (feature,source_commit,ci_evidence,gserver_runtime_evidence,
    telegram_e2e_evidence,approved_by,enabled)
  VALUES('announcement',repeat('a',40),'CI_TEST_ONLY',
    'DB_TEST_ONLY','FAKE_TELEGRAM_TEST_ONLY',111001,TRUE)`);
 await pool.query("UPDATE announcement_notifications SET state='sent' WHERE state='pending'");
 await pool.query(
  `INSERT INTO announcement_notifications
    (announcement_id,recipient_user_id,event_key,payload)
  VALUES($1,222001,'db-notify-success','{"action":"accepted"}'::jsonb)`,
  [linkedId]);
 const calls:string[]=[];
 const fake={sendMessage:async(_user:number,message:string)=>{
  calls.push(message);return {message_id:9001};
 }} as unknown as Telegram;
 process.env.GAYBBS_NOTIFICATION_DELIVERY_ENABLED="enabled";
 const sent=await deliverNextAnnouncementNotification(fake);
 assert.equal(sent?.state,"sent");
 assert.equal(calls.length,1);
 assert.equal(await deliverNextAnnouncementNotification(fake),null);
 await pool.query(
  `INSERT INTO announcement_notifications
    (announcement_id,recipient_user_id,event_key,payload)
   VALUES($1,222001,'db-notify-ambiguous','{"action":"accepted"}'::jsonb)`,
  [linkedId]);
 const ambiguous={sendMessage:async()=>{throw new Error("SIMULATED_TIMEOUT")}} as unknown as Telegram;
 const uncertain=await deliverNextAnnouncementNotification(ambiguous);
 assert.equal(uncertain?.state,"needs_reconcile");
 assert.equal(await deliverNextAnnouncementNotification(fake),null,
  "Unknown Telegram outcome must never be auto-sent again");
 delete process.env.GAYBBS_NOTIFICATION_DELIVERY_ENABLED;
 console.log("GAYBBS_DB_NOTIFICATION_UNKNOWN_NEVER_RETRY=PASS");
 // Simulate all auxiliary meeting records to detect forgotten cleanup paths.
 await pool.query(
  `INSERT INTO room_participation_reports(room_id,reporter_user_id,report_type)
   VALUES($1,222001,'join_failed')`,[roomId]);
 await pool.query(
  `INSERT INTO room_host_sessions
     (owner_user_id,room_id,expected_revision,requested_action,expires_at)
   VALUES(111001,$1,$2,'postpone',NOW()+INTERVAL '20 minutes')`,
  [roomId,source.revision]);
 await pool.query(
  `INSERT INTO public_post_drafts(owner_user_id,module,step,data)
   VALUES(111001,'room','saved',$1::jsonb)`,
  [JSON.stringify({roomId})]);
 await pool.query(
  `INSERT INTO announcement_application_entries(token_hash,announcement_id,expires_at)
   VALUES('db-room-entry',$1,NOW()+INTERVAL '1 day')`,[linkedId]);
 await pool.query(
  `INSERT INTO announcement_application_sessions(applicant_user_id,token_hash,expires_at)
   VALUES(222001,'db-room-entry',NOW()+INTERVAL '1 hour')`);
 const ended=await updateRoomState(111001,roomId,source.revision,"finish");
 assert.equal(ended.state,"finished");
 assert.ok(ended.eventId);
 assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM room_posts WHERE room_id=$1",[roomId]
 )).rows[0].n,1,"ROOM DB must remain until Telegram end badge confirmed");
 await projectNextRoomEvent();
 // Terminal reconciliation and actual DB disposal are verified in a
 // separate, fully-gated scenario below.

 const joinRoom=await pool.query(
  `INSERT INTO room_posts(request_key,owner_user_id,title,mode,join_url,status)
   VALUES('db-approved-room',111001,'承認制ROOM','jitsi',
      'https://meet.jit.si/PRIVATE_ACCEPTED_ONLY','ready')
   RETURNING room_id`);
 const privateRoomId=Number(joinRoom.rows[0].room_id);
 const recruitment=await pool.query(
  `INSERT INTO announcement_posts
    (request_key,owner_user_id,kind,text,status,room_id,capacity,accept_applications)
   VALUES('db-approved-room-recruit',111001,'recruitment',
      '承認制テスト','published',$1,2,TRUE)
   RETURNING announcement_id`,[privateRoomId]);
 const recruitmentId=Number(recruitment.rows[0].announcement_id);
 const accepted=await submitApplication(recruitmentId,333001,null);
 await submitApplication(recruitmentId,333002,null);
 assert.ok(await getAuthorizedRoom(111001,privateRoomId),
  "ROOM host must retain private access");
 assert.equal(await getAuthorizedRoom(333001,privateRoomId),null,
  "Pending applicant must not receive the URL");
 await decideApplication(111001,recruitmentId,accepted.applicationId,"accepted");
 assert.equal(await getAuthorizedRoom(333001,privateRoomId),null,
  "Even an approved applicant must not enter a ROOM before the host starts it");
 const acceptedLive=await updateRoomState(111001,privateRoomId,1,"start");
 assert.ok((await getAuthorizedRoom(333001,privateRoomId))?.joinUrl.includes("PRIVATE_ACCEPTED_ONLY"));
 assert.equal(await getAuthorizedRoom(333002,privateRoomId),null,
  "Another pending applicant must not gain URL access");
 assert.equal(await getAuthorizedRoom(444001,privateRoomId),null,
  "Unrelated user must never obtain ROOM URL");
 assert.equal((await listAuthorizedRooms(333001)).some(r=>r.id===privateRoomId),true);
 const cancelled=await updateRoomState(111001,privateRoomId,acceptedLive.revision,"cancel");
 assert.equal(cancelled.state,"cancelled");
 assert.equal(await getAuthorizedRoom(333001,privateRoomId),null,
  "Cancelled ROOM must remove join URL and user records");
 assert.equal((await pool.query(
  "SELECT status FROM room_posts WHERE room_id=$1",[privateRoomId]
 )).rows[0].status,"cancelled","cancelled ROOM retained only pending status/notification sync");
 console.log("GAYBBS_DB_ROOM_JOIN_AUTHORIZATION=PASS");
 // Separate private creation is idempotent and has no MPB send.
 const privateSaved=await createRoom(555001,1,"プライベート作成");
 const privateSame=await createRoom(555001,1,"プライベート作成");
 assert.equal(privateSaved.sourceId,privateSame.sourceId);
 assert.equal(privateSaved.joinUrl,privateSame.joinUrl);
 const status=await pool.query(
  "SELECT status,join_visibility FROM room_posts WHERE room_id=$1",
  [privateSaved.sourceId]);
 assert.equal(status.rows[0].status,"draft");
 assert.equal(status.rows[0].join_visibility,"approved_only");
 const linkedDraft=await createAnnouncement(555001,1,"announcement",
  "ROOM作成のお知らせ（非公開）",undefined,[],[],
  Number(privateSaved.sourceId));
 const linkedSame=await createAnnouncement(555001,1,"announcement",
  "ROOM作成のお知らせ（非公開）",undefined,[],[],
  Number(privateSaved.sourceId));
 assert.equal(linkedDraft.sourceId,linkedSame.sourceId);
 const linkState=await pool.query(
  "SELECT status,room_id FROM announcement_posts WHERE announcement_id=$1",
  [linkedDraft.sourceId]);
 assert.equal(linkState.rows[0].status,"draft");
 assert.equal(Number(linkState.rows[0].room_id),Number(privateSaved.sourceId));
 const actualPosts=await pool.query(
  "SELECT count(*)::int AS n FROM posting_deliveries WHERE source_type='announcement' AND source_id=$1",
  [linkedDraft.sourceId]);
 assert.equal(actualPosts.rows[0].n,0,"private save cannot publish Telegram");
 console.log("GAYBBS_DB_ROOM_PRIVATE_SAVE_IDEMPOTENT=PASS");
 // Free joining requires both explicit host choice AND an actually published
 // matching Announcement; no default grant and no URL in public message data.
 const chosen=await changeRoomVisibility(555001,Number(privateSaved.sourceId),1,"public");
 assert.equal(chosen.visibility,"public");
 assert.equal(await getAuthorizedRoom(666001,Number(privateSaved.sourceId)),null,
  "Unready room can never distribute the URL");
 const prepared=await updateRoomState(555001,Number(privateSaved.sourceId),
  chosen.revision,"prepare");
 assert.equal(prepared.state,"ready");
 assert.equal(await getAuthorizedRoom(666001,Number(privateSaved.sourceId)),null,
  "Even a prepared public-mode room requires published Announcement");
 await pool.query(
  "UPDATE announcement_posts SET status='published' WHERE announcement_id=$1",
  [linkedDraft.sourceId]);
 assert.equal(await getAuthorizedRoom(666001,Number(privateSaved.sourceId)),null,
  "Business status alone must never grant public join access without Telegram delivery");
 const topic=await pool.query(
  `INSERT INTO posting_topics
    (board_key,purpose,chat_id,message_thread_id,title,verified_by,verified_at,enabled)
    VALUES('video_chat','announcement',-1002373696859,123,'CI-only topic',
      111001,NOW(),TRUE) RETURNING topic_id`);
 await pool.query(
  `INSERT INTO posting_deliveries
    (source_type,source_id,owner_user_id,source_revision,posting_topic_id,
      operation_key,status,telegram_message_id)
    VALUES('announcement',$1,555001,1,$2,$3,'sent',10001)`,
  [linkedDraft.sourceId,topic.rows[0].topic_id,
   "db-test-published-room:"+linkedDraft.sourceId]);
 assert.equal(await getAuthorizedRoom(666001,Number(privateSaved.sourceId)),null,
  "Prepared ROOM with a public post is still not LIVE");
 const reverted=await changeRoomVisibility(
  555001,Number(privateSaved.sourceId),prepared.revision,"approved_only");
 assert.equal(reverted.visibility,"approved_only");
 await assert.rejects(
  ()=>changeRoomVisibility(999999,Number(privateSaved.sourceId),
    reverted.revision,"public"),/ROOM_NOT_OWNED/);
 const publicAgain=await changeRoomVisibility(
  555001,Number(privateSaved.sourceId),reverted.revision,"public");
 const live=await updateRoomState(555001,Number(privateSaved.sourceId),publicAgain.revision,"start");
 assert.equal(live.state,"live");
 const guest=await getAuthorizedRoom(666001,Number(privateSaved.sourceId));
 assert.equal(guest?.id,Number(privateSaved.sourceId));
 console.log("GAYBBS_DB_ROOM_EXPLICIT_PUBLIC_MODE_AND_REVOCATION=PASS");




 // Disposable standalone Announcement: terminal/expired rows disappear with
 // application snapshots, notification payloads, tokens and MPB delivery ID.
 const ephemeral=await pool.query(
  `INSERT INTO announcement_posts(request_key,owner_user_id,kind,text,status)
   VALUES('db-purge-standalone',888001,'recruitment','PRIVATE_ONCE','closed')
   RETURNING announcement_id`);
 const obsolete=Number(ephemeral.rows[0].announcement_id);
 const active=await pool.query(
  `INSERT INTO announcement_posts(request_key,owner_user_id,kind,text,status)
   VALUES('db-purge-active',888002,'announcement','ACTIVE_KEEP','published')
   RETURNING announcement_id`);
 const keepId=Number(active.rows[0].announcement_id);
 const expired=await pool.query(
  `INSERT INTO announcement_posts
    (request_key,owner_user_id,kind,text,status,expires_at)
   VALUES('db-purge-time',888003,'preview','TIME_OUT','published',
      NOW()-INTERVAL '1 minute') RETURNING announcement_id`);
 const expiredId=Number(expired.rows[0].announcement_id);
 await pool.query(
  `INSERT INTO announcement_applications(announcement_id,applicant_user_id,consented_profile)
    VALUES($1,888010,'{"private":"remove"}'::jsonb)`,[obsolete]);
 await pool.query(
  `INSERT INTO announcement_notifications
    (announcement_id,recipient_user_id,event_key,payload)
   VALUES($1,888010,'purge-notif','{"text":"remove"}'::jsonb)`,[obsolete]);
 await pool.query(
  `INSERT INTO announcement_application_entries(token_hash,announcement_id,expires_at)
   VALUES('purge-application-token',$1,NOW()+INTERVAL '1 day')`,[obsolete]);
 await pool.query(
  `INSERT INTO announcement_application_sessions(applicant_user_id,token_hash,expires_at)
   VALUES(888010,'purge-application-token',NOW()+INTERVAL '1 day')`);
 await pool.query(
  `INSERT INTO posting_deliveries(source_type,source_id,owner_user_id,
    source_revision,posting_topic_id,operation_key,status,telegram_message_id,rendered_text)
   VALUES('announcement',$1,888001,1,$2,'purge-delivery','sent',5678,
     '📣 <b>元の募集投稿</b>・公開した本文')`,
  [String(obsolete),topic.rows[0].topic_id]);
 const abandoned=await pool.query(
  `INSERT INTO announcement_posts(request_key,owner_user_id,kind,text,
    status,created_at)
   VALUES('db-purge-no-expiry',888004,'announcement','STALE',
    'published',NOW()-INTERVAL '8 days') RETURNING announcement_id`);
 const abandonedId=Number(abandoned.rows[0].announcement_id);
 const future=await pool.query(
  `INSERT INTO announcement_posts(request_key,owner_user_id,kind,text,
    status,created_at,event_at)
   VALUES('db-purge-future',888005,'preview','FUTURE_EVENT',
    'published',NOW()-INTERVAL '8 days',NOW()+INTERVAL '10 days')
   RETURNING announcement_id`);
 const futureId=Number(future.rows[0].announcement_id);
 // The actual Telegram post must first show a terminal status. The DB
 // may be deleted only after both the post edit and recipient notices finish.
 // The fake API below never sends a real Telegram message.
 const deferred=await purgeDisposableAnnouncements();
 assert.ok(deferred>=1,"independent expired item may still be purged");
 assert.equal((await pool.query(
  "SELECT count(*)::int AS n FROM announcement_posts WHERE announcement_id=$1",
  [obsolete])).rows[0].n,1,"sent Telegram message blocks destructive DB purge");
 // Keep the historical Telegram announcement and visibly mark its end.
 // A *fake* Telegram edit proves the exact transport request without touching
 // any real group (deleteMessage and sendMessage remain forbidden).
 const announcedEdits:Array<{messageId:number;text:string}>=[];
 const archiveBot={
  editMessageText:async(_chat:number,messageId:number,_inline:unknown,text:string)=>{
   announcedEdits.push({messageId,text});return {message_id:messageId};
  },
  deleteMessage:async()=>{throw new Error("HISTORY_POST_DELETE_FORBIDDEN")},
  sendMessage:async()=>{throw new Error("DUPLICATE_POST_FORBIDDEN")},
 } as unknown as Telegram;
 process.env.GAYBBS_ANNOUNCEMENT_ARCHIVE_ENABLED="enabled";
 const receipt=await archiveNextTerminalAnnouncement(archiveBot);
 assert.equal(receipt?.status,"archived");
 assert.deepEqual(announcedEdits.map(x=>x.messageId),[5678]);
 assert.match(announcedEdits[0]!.text,/✅ 募集終了/);
 assert.match(announcedEdits[0]!.text,/元の募集投稿/);
 assert.equal(await archiveNextTerminalAnnouncement(archiveBot),null);
 delete process.env.GAYBBS_ANNOUNCEMENT_ARCHIVE_ENABLED;
 await purgeDisposableAnnouncements();
 assert.equal((await pool.query(
  "SELECT count(*)::int AS n FROM announcement_posts WHERE announcement_id=$1",
  [obsolete])).rows[0].n,1,
  "Do not delete applicant notification content just because Telegram archive succeeded");
 // Simulate a confirmed notification delivery ACK in this disposable fixture.
 // Real Telegram notification delivery is tested separately.
 await pool.query(
  "UPDATE announcement_notifications SET state='sent' WHERE announcement_id=$1",
  [obsolete]);
 const removed=await purgeDisposableAnnouncements();
 assert.ok(removed>=1,"terminal entry may be purged only after Telegram edit and notification ACK");
 for(const id of [obsolete,expiredId]){
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM announcement_posts WHERE announcement_id=$1",
   [id])).rows[0].n,0);
 }
 assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM announcement_posts WHERE announcement_id=$1",
   [keepId])).rows[0].n,1);
 assert.equal((await pool.query(
  "SELECT count(*)::int AS n FROM announcement_posts WHERE announcement_id=$1",
  [abandonedId])).rows[0].n,1,"active post without expiry must not be deleted just because it is old");
 assert.equal((await pool.query(
  "SELECT count(*)::int AS n FROM announcement_posts WHERE announcement_id=$1",
  [futureId])).rows[0].n,1,"future event must survive idle TTL");
 assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM announcement_application_sessions WHERE applicant_user_id=888010"
  )).rows[0].n,0);
 assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM posting_deliveries WHERE operation_key='purge-delivery'"
  )).rows[0].n,0);
 assert.equal(await purgeDisposableAnnouncements(),0);
 // Obsolete draft purging is bounded; a live draft is never removed.
 await pool.query(
  `INSERT INTO public_post_drafts(owner_user_id,module,step,data,updated_at)
    VALUES(899001,'announcement','awaiting_text','{"text":"old"}'::jsonb,
    NOW()-INTERVAL '9 days')`);
 await pool.query(
  `INSERT INTO public_post_drafts(owner_user_id,module,step,data,updated_at)
    VALUES(899002,'announcement','awaiting_text','{"text":"active"}'::jsonb,NOW())`);
 assert.equal(await purgeAbandonedDrafts(7),1);
 assert.equal((await pool.query(
  "SELECT count(*)::int AS n FROM public_post_drafts WHERE owner_user_id=899002"
 )).rows[0].n,1);
 console.log("GAYBBS_DB_DISPOSABLE_PURGE_NO_RESIDUE_AND_ACTIVE_PROTECTION=PASS");
 // ROOM historical post is updated twice in place; no Telegram delete
 // call, no duplicate send, no private join URL in the message.
 await pool.query(
  `INSERT INTO gaybbs_feature_release_gates
    (feature,source_commit,ci_evidence,gserver_runtime_evidence,
     telegram_e2e_evidence,approved_by,enabled)
   VALUES('room',repeat('a',40),'CI_TEST_ONLY','FAKE_DB_ONLY',
     'FAKE_TELEGRAM_ONLY',111001,TRUE)`);
 const edits:Array<{chatId:number;messageId:number;text:string}>=[];
 const historicalBot={
  editMessageText:async(chatId:number,messageId:number,_inline:unknown,
    text:string,_options:unknown)=>{
   edits.push({chatId,messageId,text});return {message_id:messageId};
  },
  deleteMessage:async()=>{throw new Error("HISTORY_DELETE_FORBIDDEN")},
  sendMessage:async()=>{throw new Error("DUPLICATE_PUBLIC_POST_FORBIDDEN")},
 } as unknown as Telegram;
 process.env.GAYBBS_ROOM_STATUS_EDIT_ENABLED="enabled";
 const liveEdit=await updateNextRoomStatusMessage(historicalBot);
 assert.equal(liveEdit?.state,"confirmed");
 assert.match(edits[0]!.text,/🔴 LIVE中/);
 assert.match(edits[0]!.text,/元の公開ROOM告知/);
 assert.equal(edits[0]!.messageId,87654);
 // The final ROOM event may have been projected later; no terminal DB purge
 // until the *same* existing Telegram message displays the end badge.
 const endEdit=await updateNextRoomStatusMessage(historicalBot);
 assert.equal(endEdit?.state,"confirmed");
 assert.match(edits[1]!.text,/⚫ 終了しました/);
 assert.equal(edits[1]!.messageId,87654);
 assert.equal(edits.length,2);
 delete process.env.GAYBBS_ROOM_STATUS_EDIT_ENABLED;
 // An unresolved DM is explicitly reconciled here in the isolated fixture.
 await pool.query(
  `UPDATE announcement_notifications SET state='sent'
   WHERE announcement_id=$1 AND state IN ('pending','needs_reconcile')`,[linkedId]);
 process.env.GAYBBS_ROOM_TERMINAL_PURGE_ENABLED="enabled";
 const purged=await finalizeNextRoom();
 assert.equal(purged,roomId);
 delete process.env.GAYBBS_ROOM_TERMINAL_PURGE_ENABLED;
 for(const [query,params] of [
  ["SELECT 1 FROM room_posts WHERE room_id=$1",[roomId]],
  ["SELECT 1 FROM room_source_events WHERE room_id=$1",[roomId]],
  ["SELECT 1 FROM room_status_message_edits WHERE edit_id=$1",[liveEdit!.editId]],
  ["SELECT 1 FROM announcement_posts WHERE announcement_id=$1",[linkedId]],
  ["SELECT 1 FROM posting_deliveries WHERE operation_key=$1",["db-room-delivery"]],
 ] as const){
  assert.equal((await pool.query(query,[...params])).rows.length,0,query);
 }
 assert.equal(edits.length,2,"Telegram historical post must remain, no deletion calls");
 console.log("GAYBBS_DB_ROOM_LIVE_END_BADGES_POST_KEPT_DB_PURGED=PASS");
 // Regression: a recruitment may be full before ROOM starts. Its public
 // message must still receive LIVE and final status rather than being skipped.
 const fullRoom=await pool.query(
  `INSERT INTO room_posts(request_key,owner_user_id,title,mode,join_url,status)
   VALUES('db-room-filled',777001,'満員ROOM','jitsi',
    'https://meet.jit.si/PRIVATE_FULL','ready') RETURNING room_id`);
 const fullRoomId=Number(fullRoom.rows[0].room_id);
 const fullAnnouncement=await pool.query(
  `INSERT INTO announcement_posts(request_key,owner_user_id,kind,text,
    status,room_id,capacity,accept_applications)
   VALUES('db-room-filled-ann',777001,'recruitment','満員募集',
     'filled',$1,1,FALSE) RETURNING announcement_id`,[fullRoomId]);
 const fullAnnouncementId=Number(fullAnnouncement.rows[0].announcement_id);
 await pool.query(
  `INSERT INTO posting_deliveries
    (source_type,source_id,owner_user_id,source_revision,posting_topic_id,
    operation_key,status,telegram_message_id,inline_buttons,rendered_text)
   VALUES('announcement',$1,777001,1,$2,'db-room-filled-message','sent',
    34567,'[]'::jsonb,'📢 <b>満員の募集本文</b>')`,
  [String(fullAnnouncementId),deliveryTopic.rows[0].topic_id]);
 const fullStarted=await updateRoomState(777001,fullRoomId,1,"start");
 // The same isolated DB holds unrelated earlier ROOM events. Process the
 // bounded queue in order, then assert by the intended event ID.
 let fullProjected:Awaited<ReturnType<typeof projectNextRoomEvent>>=null;
 for(let attempt=0;attempt<30;attempt++){
  const next=await projectNextRoomEvent();
  if(!next)break;
  if(next.eventId===fullStarted.eventId){fullProjected=next;break;}
 }
 assert.equal(fullProjected?.eventId,fullStarted.eventId);
 assert.deepEqual(fullProjected?.announcementIds,[fullAnnouncementId],
  "filled Announcement must still receive ROOM LIVE event");
 const fullEdit=await pool.query(
  `SELECT q.state FROM room_status_message_edits q
   WHERE q.room_event_id=$1`,[fullStarted.eventId]);
 assert.equal(fullEdit.rows.length,1,
  "filled Announcement must queue existing message edit");
 console.log("GAYBBS_DB_FILLED_RECRUITMENT_ROOM_STATUS=PASS");
 // Six-function shared DM: one text input has exactly one most-recent owner.
 // Older drafts are retained for explicit resume, but cannot steal a reply.
 await pool.query(
  `INSERT INTO profile_drafts(owner_user_id,step,data,updated_at)
   VALUES(777501,'awaiting_basic','{}'::jsonb,NOW()-INTERVAL '10 minutes')`);
 assert.equal(await currentDmTextOwner(777501),"profile");
 await pool.query(
  `INSERT INTO public_post_drafts(owner_user_id,module,step,data,updated_at)
   VALUES(777501,'announcement','awaiting_text','{}'::jsonb,NOW()-INTERVAL '5 minutes')`);
 assert.equal(await currentDmTextOwner(777501),"announcement");
 await pool.query(
  `INSERT INTO room_host_sessions
    (owner_user_id,room_id,expected_revision,requested_action,expires_at,updated_at)
   VALUES(777501,$1,1,'postpone',NOW()+INTERVAL '20 minutes',NOW())`,
  [fullRoomId]);
 assert.equal(await currentDmTextOwner(777501),"room_host");
 await pool.query(
  `UPDATE profile_drafts SET updated_at=NOW()+INTERVAL '1 second'
   WHERE owner_user_id=777501`);
 assert.equal(await currentDmTextOwner(777501),"profile");
 assert.equal(await currentDmTextOwner(777502),null);
 console.log("GAYBBS_DB_DM_INPUT_OWNER_NO_CROSS_MODULE_CAPTURE=PASS");
 console.log("GAYBBS_DB_MIGRATION_AND_APPLICATION_CONCURRENCY=PASS");
}finally{await closePool();}
