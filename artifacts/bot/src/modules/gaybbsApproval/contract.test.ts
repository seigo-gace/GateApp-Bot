import test from "node:test";
import assert from "node:assert/strict";
import { ADMISSION_VERSION, APPROVAL_QUESTIONS, RULES_CONSENT_QUESTION,
 admissionDocumentVersion, canAdvanceAdmission, ADMISSION_BOARD_CHAT_IDS,
 sharedAdmissionDocumentVersion, allThreeBoardsApproved } from "./contract.js";

const links = {
 guideline: "https://example.org/guideline",
 terms: "https://example.org/terms",
 privacy: "https://example.org/privacy",
 rules: "https://example.org/rules",
};

test("approved exact two questions and separate group rule remain unchanged", () => {
 assert.equal(APPROVAL_QUESTIONS.length, 2);
 assert.match(APPROVAL_QUESTIONS[0]!.text, /18歳以上/);
 assert.match(APPROVAL_QUESTIONS[1]!.text, /Privacy Policy/);
 assert.match(RULES_CONSENT_QUESTION, /グループルール/);
});

test("consent stage cannot be skipped, falsified or replayed in another stage", () => {
 const yes = (stage: "question1"|"question2"|"rules") => ({stage,accepted:true});
 const no = (stage: "question1"|"question2"|"rules") => ({stage,accepted:false});
 assert.equal(canAdvanceAdmission("intro","challenge"),true);
 assert.equal(canAdvanceAdmission("intro","q1"),false);
 assert.equal(canAdvanceAdmission("challenge","q1"),true);
 assert.equal(canAdvanceAdmission("challenge","rejected"),true);
 assert.equal(canAdvanceAdmission("challenge","issuing"),false);
 assert.equal(canAdvanceAdmission("q1","q2",yes("question1")),true);
 assert.equal(canAdvanceAdmission("q1","rules",yes("question1")),false);
 assert.equal(canAdvanceAdmission("q1","q2",no("question1")),false);
 assert.equal(canAdvanceAdmission("q1","q2",yes("question2")),false);
 assert.equal(canAdvanceAdmission("q1","rejected",no("question1")),true);
 assert.equal(canAdvanceAdmission("q2","rules",yes("question2")),true);
 assert.equal(canAdvanceAdmission("q2","issuing",yes("question2")),false);
 assert.equal(canAdvanceAdmission("rules","issuing",yes("rules")),true);
 assert.equal(canAdvanceAdmission("rules","issuing",no("rules")),false);
 assert.equal(canAdvanceAdmission("rules","rejected",no("rules")),true);
 assert.equal(canAdvanceAdmission("approved","issuing",yes("rules")),false);
});

test("document version is stable until questions, links or group rules change", () => {
 const one=admissionDocumentVersion(1,"現在のグループルール",links);
 assert.equal(one.startsWith(ADMISSION_VERSION + ":"),true);
 assert.equal(one,admissionDocumentVersion(1,"現在のグループルール",links));
 assert.notEqual(one,admissionDocumentVersion(2,"現在のグループルール",links));
 assert.notEqual(one,admissionDocumentVersion(1,"改訂済みグループルール",links));
 assert.notEqual(one,admissionDocumentVersion(1,"現在のグループルール",{
  ...links, privacy:"https://example.org/privacy-v2",
 }));
 assert.throws(() => admissionDocumentVersion(0,"現在のグループルール",links));
 assert.throws(() => admissionDocumentVersion(1,"",links));
 assert.throws(() => admissionDocumentVersion(1,"現在のグループルール",{
  ...links, terms:"http://example.org/terms",
 }));
});

test("shared common approval accepts exactly the 3 adopted groups and one consent revision",()=>{
 const boards=ADMISSION_BOARD_CHAT_IDS.map((chatId,i)=>({
  targetId:100+i,chatId,title:"Group "+(i+1),
  rulesText:"Board rule "+(i+1),
  links:{...links},
 }));
 const version=sharedAdmissionDocumentVersion(boards);
 assert.equal(version.startsWith(ADMISSION_VERSION+":"),true);
 assert.equal(version,sharedAdmissionDocumentVersion([...boards].reverse()),
  "entry group must not change common consent identity");
 assert.notEqual(version,sharedAdmissionDocumentVersion(boards.map((b,i)=>
  i===1?{...b,rulesText:"New group 2 rule"}:b)),
  "any of the 3 group rules invalidates old consent");
 assert.notEqual(version,sharedAdmissionDocumentVersion(boards.map((b,i)=>
  i===2?{...b,links:{...b.links,terms:"https://example.org/terms-v2"}}:b)),
  "a document link change in group 3 invalidates old consent");
 assert.throws(()=>sharedAdmissionDocumentVersion(boards.slice(0,2)),
  /GATE_THREE_BOARDS_REQUIRED/);
 assert.throws(()=>sharedAdmissionDocumentVersion([...boards.slice(0,2),boards[0]!]),
  /GATE_BOARD_MAP_INVALID/);
 assert.throws(()=>sharedAdmissionDocumentVersion([...boards.slice(0,2),
  {...boards[2]!,chatId:-1005555000999}]),/GATE_BOARD_MAP_INVALID/);
});

test("global denial for every group when ANY of three approval states is rejected",()=>{
 const all=ADMISSION_BOARD_CHAT_IDS.map(chat_id=>({chat_id,status:"approved"}));
 assert.equal(allThreeBoardsApproved(all),true);
 for(let index=0;index<3;index++){
  const oneRejected=all.map((r,i)=>i===index?{...r,status:"rejected"}:r);
  assert.equal(allThreeBoardsApproved(oneRejected),false,
   "a rejection by board "+index+" blocks all boards");
  assert.equal(allThreeBoardsApproved(all.filter((_,i)=>i!==index)),false,
   "missing any of three approvals blocks all boards");
 }
 assert.equal(allThreeBoardsApproved([...all,all[0]!]),false,
  "duplicate entitlements must not bypass the global decision");
 assert.equal(allThreeBoardsApproved([
  {...all[0]!,status:"pending"},all[1]!,all[2]!,
 ]),false);
});
