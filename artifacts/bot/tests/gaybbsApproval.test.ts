import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {APPROVAL_QUESTIONS,ADMISSION_VERSION,hasAdoptedQuestions,isSafeDocUrl,
 acceptedStagesComplete} from "../src/modules/gaybbsApproval/contract.js";
import {pool} from "../src/db/index.js";
import {openAttempt,readAttempt,rememberScreen,transition,consentsComplete,
 saveIssuedInvite,currentIssuedInvite,getRequestEligibility,withAdmissionClient}
 from "../src/modules/gaybbsApproval/store.js";

test("adopted question pair requires exact text, yes-label and disabled third question",()=>{
 const rows=APPROVAL_QUESTIONS.map((q,i)=>({
  order_index:i+1,enabled:true,question_text:q.text,
  button1_label:q.yes,button2_label:q.no,correct_button:1,
 }));
 const three=[...rows,{order_index:3,enabled:false,question_text:"",
  button1_label:"",button2_label:"",correct_button:1}];
 assert.equal(hasAdoptedQuestions(three),true);
 assert.equal(hasAdoptedQuestions(rows),false);
 assert.equal(hasAdoptedQuestions(three.map((r,i)=>i===1?{...r,correct_button:2}:r)),false);
 assert.equal(hasAdoptedQuestions(three.map((r,i)=>i===2?{...r,enabled:true}:r)),false);
 assert.equal(acceptedStagesComplete(["question1","question2"]),false);
 assert.equal(acceptedStagesComplete(["question1","question2","rules"]),true);
 assert.equal(isSafeDocUrl("https://example.org/terms"),true);
 assert.equal(isSafeDocUrl("http://example.org/terms"),false);
});
test("durable admission has stage CAS, three consent receipts and user-bound invite checks",async()=>{
 // CI uses its own disposable PostgreSQL service. No real Telegram API or secrets.
 const targetId=400000+Math.floor(Math.random()*100000);
 const userId=700000000+Math.floor(Math.random()*100000);
 const intruder=userId+1000000;
 const chatId=-1004000000000-targetId;
 const code=randomUUID().replaceAll("-","");
 const url="https://t.me/+test_"+code;
 let started=false;
 try{
  await pool.query(`INSERT INTO targets
   (target_id,owner_user_id,target_type,chat_id,title,gate_code)
   VALUES($1,1,'entry_group',$2,'test gate',$3)`,[targetId,chatId,code]);
  started=true;
  const {attempt}=await openAttempt(userId,targetId,"aaaaaaaaaaaaaaaaaa");
  assert.equal(attempt.step,"intro");
  assert.equal(attempt.document_version,ADMISSION_VERSION);
  assert.equal(await rememberScreen(attempt,123),true);
  const intro=await readAttempt(userId);
  assert.ok(intro);
  assert.equal(await transition({attempt:intro,messageId:123,next:"challenge",
   newToken:"bbbbbbbbbbbbbbbbbb",challengeData:{text:"2+2=?",options:["4","3"],correctIndex:0}}),true);
  assert.equal(await transition({attempt:intro,messageId:123,next:"challenge",
   newToken:"cccccccccccccccccc"}),false,"old callback cannot advance");
  let s=await readAttempt(userId);assert.ok(s);
  assert.equal(await transition({attempt:s,messageId:123,next:"q1",newToken:"cccccccccccccccccc"}),true);
  s=await readAttempt(userId);assert.ok(s);
  assert.equal(await transition({attempt:s,messageId:999,next:"q2",
   newToken:"dddddddddddddddddd",consent:{stage:"question1",accepted:true}}),false,
   "wrong message id must be rejected");
  assert.equal(await transition({attempt:s,messageId:123,next:"q2",
   newToken:"dddddddddddddddddd",consent:{stage:"question1",accepted:true}}),true);
  s=await readAttempt(userId);assert.ok(s);
  assert.equal(await consentsComplete(s),false);
  assert.equal(await transition({attempt:s,messageId:123,next:"rules",
   newToken:"eeeeeeeeeeeeeeeeee",consent:{stage:"question2",accepted:true}}),true);
  s=await readAttempt(userId);assert.ok(s);
  assert.equal(await transition({attempt:s,messageId:123,next:"issuing",
   newToken:"ffffffffffffffffff",consent:{stage:"rules",accepted:true}}),true);
  s=await readAttempt(userId);assert.ok(s);
  assert.equal(await consentsComplete(s),true);
  const expires=new Date(Date.now()+3600_000);
  assert.equal(await saveIssuedInvite(s,url,expires),true);
  const approved=await readAttempt(userId);assert.ok(approved);
  assert.equal(approved.step,"approved");
  assert.equal(await currentIssuedInvite(approved),url);
  await withAdmissionClient(async client=>{
   await client.query("BEGIN");
   try{
    const legit=await getRequestEligibility(client,{targetId,userId,url});
    const stolen=await getRequestEligibility(client,{targetId,userId:intruder,url});
    assert.equal(legit.allowed,true);
    assert.equal(stolen.allowed,false);
    assert.equal((await getRequestEligibility(client,{targetId,userId,url:url+"stolen"})).allowed,false);
   }finally{await client.query("ROLLBACK")}
  });
  const counts=await pool.query(`SELECT COUNT(*)::int AS n FROM gate_consents
   WHERE target_id=$1 AND tg_user_id=$2 AND attempt_id=$3`,
   [targetId,userId,approved.attempt_id]);
  assert.equal(counts.rows[0].n,3);
 }finally{
  if(started){
   await pool.query("DELETE FROM invite_links WHERE target_id=$1",[targetId]);
   await pool.query("DELETE FROM gate_consents WHERE target_id=$1",[targetId]);
   await pool.query("DELETE FROM gate_sessions WHERE target_id=$1",[targetId]);
   await pool.query("DELETE FROM approvals WHERE target_id=$1",[targetId]);
   await pool.query("DELETE FROM targets WHERE target_id=$1",[targetId]);
  }
 }
});
