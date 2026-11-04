import test from "node:test";
import assert from "node:assert/strict";
import {parseProfileBasic, renderProfileBasicPreview, isProfilePosition} from "../src/services/profileCore.js";

test("one message captures optional name and three numbers", () => {
  assert.deepEqual(parseProfileBasic("ゼロ\n175 80 39"),
    {nickname:"ゼロ",heightCm:175,weightKg:80,age:39});
  assert.deepEqual(parseProfileBasic("175 80 39"),
    {nickname:null,heightCm:175,weightKg:80,age:39});
});
test("invalid format or out of range values are rejected", () => {
  for (const input of ["175\n80\n39","175,80,39","175  80 39","175 80 19",
    "260 80 39","175 310 39","x".repeat(41)+"\n175 80 39"]) {
    assert.throws(() => parseProfileBasic(input), Error);
  }
});
test("position is only one of the five fixed options", () => {
  assert.equal(isProfilePosition("ウケリバ"),true);
  assert.equal(isProfilePosition("その他"),false);
});
test("profile preview is safe HTML and preserves all section headings", () => {
  const result=renderProfileBasicPreview({
    nickname:"<script>&A",heightCm:175,weightKg:80,age:39,position:"タチ",
  },"valid_user");
  assert.ok(result.includes("&lt;script&gt;&amp;A"));
  assert.ok(!result.includes("<script>"));
  assert.ok(result.includes("#Like"));
  assert.ok(result.includes("#Love"));
  assert.ok(result.includes("髪型： | 体型："));
  assert.ok(result.includes("https://t.me/valid_user"));
});
test("no nickname displays account link instead", () => {
  const result=renderProfileBasicPreview({
    nickname:null,heightCm:175,weightKg:80,age:39,position:"リバ",
  },"valid_user");
  assert.ok(result.includes("@valid_user"));
  assert.throws(() => renderProfileBasicPreview({
    nickname:null,heightCm:175,weightKg:80,age:39,
  },"bad user"));
});
