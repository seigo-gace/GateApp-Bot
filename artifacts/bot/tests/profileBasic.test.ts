import test from "node:test";
import assert from "node:assert/strict";
import {parseProfileBasic, renderProfileBasicPreview, isProfilePosition} from "../src/services/profileCore.js";

test("one message requires adopted name and three numbers", () => {
  assert.deepEqual(parseProfileBasic("ゼロ\n175 80 39"),
    {nickname:"ゼロ",heightCm:175,weightKg:80,age:39});
  assert.throws(() => parseProfileBasic("175 80 39"),/ニックネーム/);
});
test("all four agreed three-number separators are accepted", () => {
  for (const second of ["175 80 40", "175/80/40", "175#80#40", "175-80-40"]) {
    assert.deepEqual(parseProfileBasic("ゼロ\n"+second),{
      nickname:"ゼロ",heightCm:175,weightKg:80,age:40
    });
  }
});

test("invalid format or values outside the agreed limits are rejected", () => {
  for (const input of [
    "175 80 39","ゼロ\n175,80,39","ゼロ\n175  80 39",
    "ゼロ\n175/80-40","ゼロ\n175#80","ゼロ\nabc/80/40",
    "ゼロ\n99/80/40","ゼロ\n251/80/40","ゼロ\n300/80/40",
    "ゼロ\n175/49/40","ゼロ\n175/251/40","ゼロ\n175/300/40",
    "ゼロ\n175/80/18","ゼロ\n175/80/90",
    "x".repeat(41)+"\n175 80 39"
  ]) assert.throws(() => parseProfileBasic(input),Error);
});

test("new bounds include 100-250cm, 50-250kg, and age 19-89", () => {
  assert.equal(parseProfileBasic("境界\n100/50/19").age,19);
  assert.equal(parseProfileBasic("境界\n250-250-89").age,89);
});
test("position is one of the seven adopted options", () => {
  assert.equal(isProfilePosition("ウケリバ"),true);
  assert.equal(isProfilePosition("S"),true);
  assert.equal(isProfilePosition("M"),true);
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
