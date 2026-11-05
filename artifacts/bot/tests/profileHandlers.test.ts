import test from "node:test";
import assert from "node:assert/strict";
import {registerProfileHandlers} from "../src/bot/profileHandlers.js";

function fixture() {
  const handlers = new Map<string, Function>();
  let draft: any = null;
  let profile: any = null;
  let saves = 0;
  let discards = 0;
  let revisionCounter = 0;
  let screenId = 98;
  const sent: any[] = [];
  let deleteInputFails = false;
  const repo = {
    async getDraft() { return draft; },
    async bindScreenMessage(_id:number,revision:number,messageId:number) {
      assert.equal(draft?.revision,revision);
      draft.data.screenMessageId=messageId;
    },
    async discardDraft(_id: number, expectedRevision: number) {
      if (!draft || draft.revision !== expectedRevision) return false;
      draft = null;
      discards++;
      return true;
    },
    async putDraft(_id: number, step: string, data: any, expected?: number) {
      if (expected !== undefined && draft?.revision !== expected) throw Error("PROFILE_DRAFT_STALE");
      draft = {step, data, revision: ++revisionCounter};
      return draft;
    },
    async getProfile() { return profile; },
    async savePrivateDraft(_id: number, revision: number, username: string) {
      assert.equal(draft?.revision, revision);
      assert.equal(draft?.step, "preview");
      saves++;
      profile = {...draft.data, username, status: "private", revision: 1};
      draft = null;
      return profile;
    },
  };
  const bot = {
    command(k: string, fn: Function) { handlers.set("command:" + k, fn); },
    action(k: any, fn: Function) { handlers.set(k instanceof RegExp ? "action:" + k.source : "action:" + k, fn); },
    on(k: string, fn: Function) { handlers.set("on:" + k, fn); },
  };
  registerProfileHandlers(bot as any, repo as any, async () => draft ? "profile" : null);
  function ctx(message = "") {
    return {
      chat: {type: "private", id: 4321}, from: {id: 4321, username: "valid_user"},
      message: {text: message, message_id: 123}, match: [] as string[],
      callbackQuery: {message: {message_id: 99}},
      telegram: {
        editMessageText: async (...args:any[])=>{sent.push(["screen-edit",...args]);},
        deleteMessage: async (...args:any[])=>{sent.push(["screen-delete",...args]);},
      },
      deleteMessage: async ()=>{sent.push(["input-delete",123]);if(deleteInputFails)throw Error("Telegram rejected deletion");},
      reply: async (...args: any[]) => { sent.push(["reply", ...args]); return {message_id: ++screenId}; },
      editMessageText: async (...args: any[]) => { sent.push(["edit", ...args]); },
      answerCbQuery: async (...args: any[]) => { sent.push(["answer", ...args]); },
    };
  }
  const action = (key: string, values: string[] = []) => {
    const cb = ctx();
    cb.match = ["", ...values];
    return handlers.get("action:" + key)!(cb);
  };
  const send = (text: string) => handlers.get("on:text")!(ctx(text), async () => { throw Error("text leaked to unrelated handler"); });
  const start = () => handlers.get("command:profile")!(ctx());
  return {handlers, repo, ctx, sent, action, send, start,
    failDelete() {deleteInputFails=true;},
    get draft() {return draft;},
    get profile() {return profile;},
    get saves() {return saves;},
    get discards() {return discards;}};
}
const positions = [["タチ","タチリバ","リバ"],["ウケリバ","ウケ","S","M"],["キャンセルして戻る"]];
const positionAction = String.raw`^pf:pos:(\d+):([0-6])$`;
const cancelAction = String.raw`^pf:cancel:(\d+)$`;
const saveAction = String.raw`^pf:save:(\d+)$`;

test("first screen explains how to send normal text and shows 3/4 button rows on iOS/Android-compatible inline markup", async () => {
  const f = fixture();
  await f.start();
  assert.equal(f.draft.step,"awaiting_basic");
  const r = f.sent.find(x => x[0] === "reply");
  const body: string = r[1];
  for (const phrase of ["プロフィールを作成しましょう", "登録するだけではグループに公開されません",
    "① ニックネーム", "② 下の7つ", "③ 入力内容", "ゼロ\n175 80 40",
    "100〜250cm", "50〜250kg", "18〜89歳","通常のメッセージ"]) {
    assert.ok(body.includes(phrase), phrase);
  }
  assert.deepEqual(r[2].reply_markup.inline_keyboard.map((row: any[]) => row.map(b => b.text)),positions);
  assert.ok(!r[2].reply_markup.keyboard,"no custom reply keyboard");
  assert.ok(!r[2].reply_markup.inline_keyboard.flat().some((b: any) => b.web_app || b.callback_game));
});

test("text first then position: preview, private save and no public post", async () => {
  const f = fixture();
  await f.start();
  await f.send("ゼロ\n175/80/40");
  assert.equal(f.draft.step,"awaiting_position");
  const pos = f.sent.at(-1);
  assert.equal(pos[0],"screen-edit");
  assert.deepEqual(pos[5].reply_markup.inline_keyboard.map((row:any[])=>row.map(b=>b.text)),positions);
  await f.action(positionAction, [String(f.draft.revision),"6"]);
  assert.equal(f.draft.step,"preview");
  assert.equal(f.draft.data.position,"M");
  await f.action(saveAction,[String(f.draft.revision)]);
  assert.equal(f.saves,1);
  assert.equal(f.profile.status,"private");
  assert.equal(f.profile.age,40);
  assert.ok(f.sent.some(x=>x[0]==="edit" && String(x[1]).includes("グループには投稿していません")));
});

test("position first then text: selection persists and preview contains selected position", async () => {
  const f=fixture();
  await f.start();
  await f.action(positionAction,[String(f.draft.revision),"5"]);
  assert.equal(f.draft.step,"awaiting_basic");
  assert.equal(f.draft.data.position,"S");
  const last=f.sent.at(-1);
  assert.equal(last[0],"edit");
  assert.ok(String(last[1]).includes("選択中：S"));
  assert.deepEqual(last[2].reply_markup.inline_keyboard.map((row:any[])=>row.map(b=>b.text)),positions);
  await f.send("ゼロ\n175#80#40");
  assert.equal(f.draft.step,"preview");
  assert.equal(f.draft.data.position,"S");
  assert.ok(f.sent.at(-1)[4].includes("S"));
});

test("invalid numeric text can be retried and keeps position already chosen", async () => {
  const f=fixture();
  await f.start();
  await f.action(positionAction,[String(f.draft.revision),"5"]);
  const rev=f.draft.revision;
  await f.send("ゼロ\n300/80/40");
  assert.equal(f.draft.step,"awaiting_basic");
  assert.equal(f.draft.revision,rev);
  assert.equal(f.draft.data.position,"S");
  const err=f.sent.at(-1);
  assert.ok(err[4].includes("もう一度テキストを送信"));
  assert.deepEqual(err[5].reply_markup.inline_keyboard.map((row:any[])=>row.map(b=>b.text)),positions);
  await f.send("ゼロ\n175-80-18");
  assert.equal(f.draft.step,"preview");
  assert.equal(f.draft.data.age,18);
  assert.equal(f.draft.data.position,"S");
});

test("cancel is revision-bound: clears active draft only and returns to profile entry",async()=>{
  const f=fixture();
  await f.start();
  const previous=String(f.draft.revision);
  await f.action(cancelAction,[previous]);
  assert.equal(f.draft,null);
  assert.equal(f.discards,1);
  assert.ok(f.sent.at(-1)[1].includes("キャンセルしました"));
  assert.equal(f.sent.at(-1)[2].reply_markup.inline_keyboard[0][0].text,"🪪 プロフ作成");
  await f.action("pf:restart");
  assert.equal(f.draft.step,"awaiting_basic");
  await f.action(cancelAction,[previous]);
  assert.equal(f.draft.step,"awaiting_basic","a stale mobile button must not erase newer state");
});

test("cancel after editing never deletes an existing private profile",async()=>{
  const f=fixture();
  await f.start();
  await f.send("ゼロ\n175 80 39");
  await f.action(positionAction,[String(f.draft.revision),"0"]);
  await f.action(saveAction,[String(f.draft.revision)]);
  const saved=f.profile;
  await f.action("pf:edit:basic");
  assert.ok(f.draft);
  await f.action(cancelAction,[String(f.draft.revision)]);
  assert.deepEqual(f.profile,saved);
});

test("old callback, missing username and unrelated text are handled safely",async()=>{
  const f=fixture();
  let resumed=false;
  await f.handlers.get("on:text")!(f.ctx("unrelated"),async()=>{resumed=true;});
  assert.equal(resumed,true);
  const c=f.ctx();delete (c.from as any).username;
  await f.handlers.get("command:profile")!(c);
  assert.equal(f.draft,null);
  await f.start();
  await f.action(positionAction,["999","2"]);
  assert.equal(f.draft.step,"awaiting_basic");
});

test("wizard edits the same original screen and deletes both valid and invalid input messages",async()=>{
  const f=fixture();
  await f.start();
  const initial=f.draft.data.screenMessageId;
  await f.send("ゼロ\n300/80/40");
  await f.send("ゼロ\n175/80/40");
  assert.equal(f.sent.filter(x=>x[0]==="input-delete").length,2);
  const edits=f.sent.filter(x=>x[0]==="screen-edit");
  assert.equal(edits.length,2);
  assert.ok(edits.every(x=>x[2]===initial));
  assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});
test("delete API failure does not claim cleanup and shows manual-delete warning",async()=>{
  const f=fixture();
  await f.start();
  f.failDelete();
  await f.send("ゼロ\n175/80/40");
  const edit=f.sent.find(x=>x[0]==="screen-edit");
  assert.ok(edit[4].includes("手動で削除してください"));
});
