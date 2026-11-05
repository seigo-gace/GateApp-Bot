import test from "node:test";
import assert from "node:assert/strict";
import {registerProfileHandlers} from "../src/bot/profileHandlers.js";

function fixture() {
  const handlers = new Map<string, Function>();
  let draft: any = null;
  let profile: any = null;
  let saves = 0;
  const repo = {
    async getDraft() {return draft;},
    async putDraft(_id: number, step: string, data: any, expected?: number) {
      if (expected !== undefined && draft?.revision !== expected) throw Error("PROFILE_DRAFT_STALE");
      draft = {step,data,revision:(draft?.revision ?? 0)+1};
      return draft;
    },
    async getProfile() {return profile;},
    async savePrivateDraft(_id: number, revision: number, username: string) {
      assert.equal(draft?.revision,revision);
      assert.equal(draft?.step,"preview");
      saves++;
      profile = {...draft.data,username,status:"private",revision:1};
      draft = null;
      return profile;
    },
  };
  const bot = {
    command(k: string, fn: Function) {handlers.set("command:"+k,fn);},
    action(k: any, fn: Function) {
      handlers.set(k instanceof RegExp ? "action:"+k.source : "action:"+k,fn);
    },
    on(k: string, fn: Function) {handlers.set("on:"+k,fn);},
  };
  registerProfileHandlers(bot as any,repo as any,async()=>draft?"profile":null);
  const sent: any[] = [];
  function ctx(message = "") {
    return {
      chat:{type:"private"},from:{id:4321,username:"valid_user"},
      message:{text:message},match:[] as string[],
      reply:async (...args: any[])=>{sent.push(["reply",...args]);return {message_id:99};},
      editMessageText:async (...args: any[])=>{sent.push(["edit",...args]);},
      answerCbQuery:async (...args: any[])=>{sent.push(["answer",...args]);},
    };
  }
  return {handlers,repo,ctx,sent,get draft(){return draft;},
    get profile(){return profile;},get saves(){return saves;}};
}

test("real user profile DM: input, position, private save", async () => {
  const f=fixture();
  await f.handlers.get("command:profile")!(f.ctx());
  assert.equal(f.draft.step,"awaiting_basic");
  await f.handlers.get("on:text")!(f.ctx("ゼロ\n175 80 39"),async()=>{throw Error("admin handler should not process profile text");});
  assert.equal(f.draft.step,"awaiting_position");
  const choose=f.ctx();
  choose.match=["","2","1"];
  await f.handlers.get("action:^pf:pos:(\\d+):([0-6])$")!(choose);
  assert.equal(f.draft.step,"preview");
  assert.equal(f.draft.data.position,"タチリバ");
  const save=f.ctx();
  save.match=["","3"];
  await f.handlers.get("action:^pf:save:(\\d+)$")!(save);
  assert.equal(f.saves,1);
  assert.equal(f.profile.status,"private");
  assert.equal(f.profile.nickname,"ゼロ");
  assert.ok(f.sent.some(x=>x[0]==="edit" && String(x[1]).includes("グループには投稿していません")));
});

test("an old callback cannot save a newer draft",async()=>{
  const f=fixture();
  await f.handlers.get("command:profile")!(f.ctx());
  await f.handlers.get("on:text")!(f.ctx("175 80 39"),async()=>{});
  const callback=f.ctx(); callback.match=["","1"];
  await f.handlers.get("action:^pf:save:(\\d+)$")!(callback);
  assert.equal(f.saves,0);
});

test("other admin text continues to the existing handler",async()=>{
  const f=fixture();
  let resumed=false;
  await f.handlers.get("on:text")!(f.ctx("admin input"),async()=>{resumed=true;});
  assert.equal(resumed,true);
});

test("username missing never creates a profile draft",async()=>{
  const f=fixture();
  const c=f.ctx(); delete (c.from as any).username;
  await f.handlers.get("command:profile")!(c);
  assert.equal(f.draft,null);
});

test("position selector renders 3 then 4 buttons with S and M at positions 3 and 4", async () => {
  const f=fixture();
  await f.handlers.get("command:profile")!(f.ctx());
  await f.handlers.get("on:text")!(f.ctx("ゼロ\n175 80 39"),async()=>{});
  const prompt=f.sent.find(x=>x[0]==="reply" && String(x[1]).includes("ポジションを選択"));
  assert.ok(prompt);
  const keyboard=prompt[2]?.reply_markup?.inline_keyboard;
  assert.deepEqual(keyboard?.map((row:any[])=>row.map((b:any)=>b.text)),[
    ["タチ","タチリバ","リバ"],["ウケリバ","ウケ","S","M"]
  ]);
  const choose=f.ctx(); choose.match=["","2","6"];
  await f.handlers.get("action:^pf:pos:(\\d+):([0-6])$")!(choose);
  assert.equal(f.draft.data.position,"M");
  assert.equal(f.draft.step,"preview");
});
