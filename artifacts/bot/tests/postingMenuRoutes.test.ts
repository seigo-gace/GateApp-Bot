import test from "node:test";
import assert from "node:assert/strict";
import {APPROVED_POSTING_ROWS,postingButtonStyle} from "../src/services/menuPanelRenderer.js";
import {POSTING_EDITOR_SPECS,POSTING_FEATURES,POSTING_PUBLIC_NAV_LABELS,
 POSTING_DM_CALLBACKS,POSTING_FEATURE_BY_LABEL,POSTING_CREATOR_URL,
 POSTING_TALK_URL,POSTING_BUG_REPORT_URL} from "../src/services/postingMenuRoutes.js";

test("all eleven labels have exactly one consistent DM/public mapping",()=>{
 const visible=APPROVED_POSTING_ROWS.flat();
 assert.equal(new Set(visible).size,11);
 assert.deepEqual(APPROVED_POSTING_ROWS.map(r=>r.length),[3,2,2,3,1]);
 assert.equal(new Set(POSTING_EDITOR_SPECS.map(x=>x.label)).size,7);
 assert.equal(new Set(POSTING_PUBLIC_NAV_LABELS).size,3);
 const allPublic=[...POSTING_EDITOR_SPECS.map(x=>x.label),
  "クリエーター投稿","雑談","紹介/招待","🐞 不具合を報告"];
 assert.deepEqual(new Set(allPublic),new Set(visible));
 assert.deepEqual(new Set(Object.keys(POSTING_DM_CALLBACKS)),
  new Set(visible.filter(x=>x!=="クリエーター投稿")));
 for(const spec of POSTING_EDITOR_SPECS){
  assert.equal(POSTING_FEATURE_BY_LABEL[spec.label],spec.feature);
  assert.ok(POSTING_FEATURES.includes(spec.feature));
  assert.match(POSTING_DM_CALLBACKS[spec.label]!,/^dm:/);
  assert.ok(["r_","m_"].includes(spec.prefix));
 }
 assert.equal(POSTING_DM_CALLBACKS["🐞 不具合を報告"],"dm:bug:open");
 assert.equal(postingButtonStyle("🐞 不具合を報告"),"danger");
 assert.deepEqual(APPROVED_POSTING_ROWS[4],["🐞 不具合を報告"]);
 assert.equal(POSTING_CREATOR_URL,"https://t.me/CreateVdobot?start=creator");
 assert.equal(POSTING_TALK_URL,"https://t.me/GayBBS_bot?start=talk");
 assert.equal(POSTING_BUG_REPORT_URL,"https://t.me/GayBBS_bot?start=bugreport");
});
