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
  let lastScreenId:number|null=null;
  const sent: any[] = [];
  let deleteInputFails = false;
  let postingMenuUrl:string|null="https://t.me/c/3847210571/501";
  const repo = {
    async getDraft() { return draft; },
    async getLastScreenMessageId(){return lastScreenId;},
    async bindScreenMessage(_id:number,revision:number,messageId:number) {
      assert.equal(draft?.revision,revision);
      draft.data.screenMessageId=messageId;
      lastScreenId=messageId;
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
      assert.ok(["preview","like-categories","like-items"].includes(draft?.step));
      saves++;
      lastScreenId=draft.data.screenMessageId ?? lastScreenId;
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
  registerProfileHandlers(bot as any, repo as any, async () => draft ? "profile" : null,
    async()=>postingMenuUrl);
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
    withoutMenu(){postingMenuUrl=null;},
    get draft() {return draft;},
    get profile() {return profile;},
    get saves() {return saves;},
    get discards() {return discards;}};
}
const positions = [["▫️ タチ","▫️ タチリバ","▫️ リバ"],["▫️ ウケリバ","▫️ ウケ","▫️ S","▫️ M"],["キャンセルして戻る"]];
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
  assert.deepEqual(last[2].reply_markup.inline_keyboard.map((row:any[])=>row.map(b=>b.text)),
    [positions[0],["▫️ ウケリバ","▫️ ウケ","✅ S","▫️ M"],positions[2]]);
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
  assert.deepEqual(err[5].reply_markup.inline_keyboard.map((row:any[])=>row.map(b=>b.text)),
    [positions[0],["▫️ ウケリバ","▫️ ウケ","✅ S","▫️ M"],positions[2]]);
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
  assert.ok(f.sent.at(-1)[1].includes("投稿メニュー"));
  assert.equal(f.sent.at(-1)[2].reply_markup.inline_keyboard[0][0].url,"https://t.me/c/3847210571/501");
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

const overviewAction=String.raw`^pf:overview:(\d+):(basic|appearance|media|like|love|preview|save|cancel)$`;
const layout=[["基本情報","容姿/エリア","🖼️画像🎬動画/自己PR"],["#Like","#Love","プレビュー"],["保存","キャンセル"]];

test("profile ① completes into approved overview A 3/3/2 within same Bot message",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"2"]);
 assert.equal(f.draft.step,"preview");
 const edit=f.sent.at(-1);
 assert.equal(edit[0],"edit");
 assert.deepEqual(edit[2].reply_markup.inline_keyboard.map((row:any[])=>row.map((b:any)=>b.text)),layout);
 assert.ok(edit[2].reply_markup.inline_keyboard.flat().every((b:any)=>b.callback_data));
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});

test("overview A has safe basic edit, pending sections do not create posts, save private",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 assert.equal(f.draft.step,"appearance");
 await f.action(appearanceBack,[String(f.draft.revision)]);
 assert.equal(f.draft.step,"preview");
 await f.action(overviewAction,[String(f.draft.revision),"basic"]);
 assert.equal(f.draft.step,"awaiting_basic");
 await f.send("ゼロ\n175 80 41");
 assert.equal(f.draft.step,"preview");
 await f.action(overviewAction,[String(f.draft.revision),"save"]);
 assert.equal(f.saves,1);
 assert.equal(f.profile.status,"private");
 assert.equal(f.profile.age,41);
});

const overviewReturnAction=String.raw`^pf:overview:(\d+):return$`;

test("A preview replaces same Bot screen and returns to exact 3/3/2 editor without a second Bot message",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"2"]);
 const revision=String(f.draft.revision);
 await f.action(overviewAction,[revision,"preview"]);
 const preview=f.sent.at(-1);
 assert.equal(preview[0],"edit");
 assert.match(preview[1],/公開前プレビュー/);
 assert.match(preview[1],/保存だけでは公開されません/);
 assert.equal(preview[2].reply_markup.inline_keyboard[0][0].callback_data,
  "pf:overview:"+revision+":return");
 await f.action(overviewReturnAction,[revision]);
 const back=f.sent.at(-1);
 assert.equal(back[0],"edit");
 assert.deepEqual(back[2].reply_markup.inline_keyboard.map((row:any[])=>row.map((b:any)=>b.text)),layout);
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});

test("A cancel returns through verified original posting menu without deleting saved profile",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"2"]);
 await f.action(overviewAction,[String(f.draft.revision),"cancel"]);
 assert.equal(f.draft,null);
 const result=f.sent.at(-1);
 assert.equal(result[0],"edit");
 assert.match(result[1],/投稿メニュー/);
 assert.equal(result[2].reply_markup.inline_keyboard[0][0].url,"https://t.me/c/3847210571/501");
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});

test("A cancel with no verified origin shows no guessed URL",async()=>{
 const f=fixture();
 f.withoutMenu();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"2"]);
 await f.action(overviewAction,[String(f.draft.revision),"cancel"]);
 const result=f.sent.at(-1);
 assert.match(result[1],/確認できない/);
 assert.equal(result[2],undefined);
});

test("A old navigation and saved old callbacks cannot corrupt new draft",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"2"]);
 const old=String(f.draft.revision);
 await f.action(overviewAction,[old,"basic"]);
 const fresh=String(f.draft.revision);
 await f.action(overviewAction,[old,"cancel"]);
 assert.equal(String(f.draft.revision),fresh);
 assert.equal(f.draft.step,"awaiting_basic");
 assert.match(String(f.sent.at(-1)[1]),/古い画面/);
});

test("required position selection is never turned off by reselect and supports a different choice",async()=>{
 const f=fixture();
 await f.start();
 await f.action(positionAction,[String(f.draft.revision),"5"]);
 assert.equal(f.draft.data.position,"S");
 await f.action(positionAction,[String(f.draft.revision),"5"]);
 assert.equal(f.draft.data.position,"S");
 assert.ok(f.sent.at(-1)[2].reply_markup.inline_keyboard[1][2].text.startsWith("✅"));
 await f.action(positionAction,[String(f.draft.revision),"6"]);
 assert.equal(f.draft.data.position,"M");
 assert.ok(f.sent.at(-1)[2].reply_markup.inline_keyboard[1][3].text.startsWith("✅"));
 assert.ok(!f.sent.at(-1)[2].reply_markup.inline_keyboard[1][2].text.startsWith("✅"));
});

test("reopening active profile never clears the draft and reuses one Bot screen",async()=>{
 const f=fixture();
 await f.start();
 const initialId=f.draft.data.screenMessageId;
 await f.action(positionAction,[String(f.draft.revision),"5"]);
 const revision=f.draft.revision;
 await f.start();
 assert.equal(f.draft.revision,revision);
 assert.equal(f.draft.data.position,"S");
 assert.equal(f.draft.data.screenMessageId,initialId);
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
 assert.ok(f.sent.some(x=>x[0]==="screen-edit"&&x[2]===initialId));
 await f.send("ゼロ\n175 80 40");
 assert.equal(f.draft.step,"preview");
 await f.start();
 assert.equal(f.draft.step,"preview");
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});
test("saved profile reopens using the same last Bot message instead of stacking replies",async()=>{
 const f=fixture();
 await f.start();
 const initialId=f.draft.data.screenMessageId;
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"save"]);
 await f.start();
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
 assert.equal(f.sent.at(-1)[0],"screen-edit");
 assert.equal(f.sent.at(-1)[2],initialId);
 assert.equal(f.profile.status,"private");
});

test("private save retains the agreed eight buttons and rejects the previous revision",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"3"]);
 const oldRevision=String(f.draft.revision);
 await f.action(overviewAction,[oldRevision,"save"]);
 assert.equal(f.profile.status,"private");
 assert.equal(f.draft.step,"preview");
 assert.notEqual(String(f.draft.revision),oldRevision);
 const rendered=f.sent.at(-1);
 assert.equal(rendered[0],"edit");
 assert.match(rendered[1],/非公開保存/);
 assert.deepEqual(rendered[2].reply_markup.inline_keyboard.map((row:any[])=>row.map((b:any)=>b.text)),layout);
 await f.action(overviewAction,[oldRevision,"cancel"]);
 assert.equal(f.draft.step,"preview");
 assert.ok(f.profile);
});
test("saved profile keeps all overview buttons after reopening",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"3"]);
 await f.action(overviewAction,[String(f.draft.revision),"save"]);
 const savedId=f.draft.data.screenMessageId;
 const previous=f.draft.revision;
 await f.start();
 assert.equal(f.draft.revision,previous);
 assert.equal(f.draft.data.screenMessageId,savedId);
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
 const rendered=f.sent.at(-1);
 assert.equal(rendered[0],"screen-edit");
 assert.deepEqual(rendered[5].reply_markup.inline_keyboard.map((row:any[])=>row.map((b:any)=>b.text)),layout);
});

const appearanceAction=String.raw`^pf:ap:(\d+):([hb]):(\d{1,2})$`;
const appearanceOpen=String.raw`^pf:ap:(\d+):open:([hb])$`;
const appearanceBack=String.raw`^pf:ap:(\d+):back$`;
test("appearance summary remains four buttons on a single row",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 assert.equal(f.draft.step,"appearance");
 const rows=f.sent.at(-1)[2].reply_markup.inline_keyboard;
 assert.deepEqual(rows.map((r:any[])=>r.map((b:any)=>b.text)),[
  ["髪型","体型","エリア","戻る"]
 ]);
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});
test("hair is its own blue 10-choice screen, and body its own green 13-choice screen",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 await f.action(appearanceOpen,[String(f.draft.revision),"h"]);
 assert.equal(f.draft.step,"hair");
 const hair=f.sent.at(-1)[2].reply_markup.inline_keyboard;
 assert.deepEqual(hair.map((r:any[])=>r.length),[3,3,3,2]);
 assert.equal(hair.slice(0,3).flat().length+hair[3].length-1,10);
 assert.ok(hair.flat().slice(0,-1).every((b:any)=>b.style==="primary"));
 assert.ok(hair[3][1].text.includes("戻る"));
 await f.action(appearanceBack,[String(f.draft.revision)]);
 assert.equal(f.draft.step,"appearance");
 await f.action(appearanceOpen,[String(f.draft.revision),"b"]);
 assert.equal(f.draft.step,"body");
 const body=f.sent.at(-1)[2].reply_markup.inline_keyboard;
 assert.deepEqual(body.map((r:any[])=>r.length),[3,3,3,3,2]);
 assert.equal(body.flat().length-1,13);
 assert.ok(body.flat().slice(0,-1).every((b:any)=>b.style==="success"));
 assert.ok(body[4][1].text.includes("戻る"));
});
test("separate hair and body optional toggles retain both selections and return to A",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 await f.action(appearanceOpen,[String(f.draft.revision),"h"]);
 await f.action(appearanceAction,[String(f.draft.revision),"h","1"]);
 assert.equal(f.draft.data.hair,"短髪");
 assert.ok(f.sent.at(-1)[2].reply_markup.inline_keyboard[0][1].text.startsWith("✅"));
 await f.action(appearanceAction,[String(f.draft.revision),"h","1"]);
 assert.equal(f.draft.data.hair,null);
 await f.action(appearanceAction,[String(f.draft.revision),"h","2"]);
 assert.equal(f.draft.data.hair,"ソフモヒ");
 const stale=String(f.draft.revision);
 await f.action(appearanceBack,[stale]);
 assert.equal(f.draft.step,"appearance");
 await f.action(appearanceAction,[stale,"h","0"]);
 assert.equal(f.draft.data.hair,"ソフモヒ");
 await f.action(appearanceOpen,[String(f.draft.revision),"b"]);
 await f.action(appearanceAction,[String(f.draft.revision),"b","8"]);
 assert.equal(f.draft.data.body,"ガチムチ");
 assert.equal(f.draft.data.hair,"ソフモヒ");
 await f.action(appearanceBack,[String(f.draft.revision)]);
 assert.equal(f.draft.step,"appearance");
 await f.action(appearanceBack,[String(f.draft.revision)]);
 assert.equal(f.draft.step,"preview");
 await f.action(overviewAction,[String(f.draft.revision),"save"]);
 assert.equal(f.profile.hair,"ソフモヒ");
 assert.equal(f.profile.body,"ガチムチ");
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});
test("reentering during hair or body selection restores the active screen",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 await f.action(appearanceOpen,[String(f.draft.revision),"b"]);
 const revision=f.draft.revision;
 await f.start();
 assert.equal(f.draft.revision,revision);
 assert.equal(f.draft.step,"body");
 assert.equal(f.sent.at(-1)[0],"screen-edit");
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});

const areaOpen=String.raw`^pf:ap:(\d+):area$`;
const regionAction=String.raw`^pf:ar:(\d+):r:(\d{1,2})$`;
const subAreaAction=String.raw`^pf:ar:(\d+):a:(\d{1,2})$`;
const areaBack=String.raw`^pf:ar:(\d+):back$`;
test("area blocks render 13 actual names and return, no fake rows",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 await f.action(areaOpen,[String(f.draft.revision)]);
 assert.equal(f.draft.step,"area-blocks");
 const rows=f.sent.at(-1)[2].reply_markup.inline_keyboard;
 assert.deepEqual(rows.map((r:any[])=>r.length),[3,3,3,3,2]);
 assert.equal(rows.flat().length,14);
 assert.ok(rows[4][0].text.includes("沖縄"));
 assert.ok(rows[4][1].text.includes("戻る"));
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
});
test("Tokyo child choice and change to Kansai never mixes region and area",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 await f.action(areaOpen,[String(f.draft.revision)]);
 await f.action(regionAction,[String(f.draft.revision),"5"]);
 assert.equal(f.draft.step,"area-children");
 assert.deepEqual(f.sent.at(-1)[2].reply_markup.inline_keyboard.map((r:any[])=>r.length),[3,3,2]);
 await f.action(subAreaAction,[String(f.draft.revision),"1"]);
 assert.equal(f.draft.data.region,"東京");
 assert.equal(f.draft.data.area,"新宿");
 const stale=String(f.draft.revision);
 await f.action(areaBack,[stale]);
 await f.action(subAreaAction,[stale,"0"]);
 assert.equal(f.draft.data.area,"新宿");
 await f.action(regionAction,[String(f.draft.revision),"8"]);
 assert.equal(f.draft.step,"area-children");
 assert.equal(f.draft.data.region,"東京");
 assert.equal(f.draft.data.area,"新宿");
 await f.action(subAreaAction,[String(f.draft.revision),"2"]);
 assert.equal(f.draft.data.region,"関西");
 assert.equal(f.draft.data.area,"大阪キタ");
 await f.action(subAreaAction,[String(f.draft.revision),"2"]);
 assert.equal(f.draft.data.region,null);
 assert.equal(f.draft.data.area,null);
 await f.action(areaBack,[String(f.draft.revision)]);
 await f.action(areaBack,[String(f.draft.revision)]);
 assert.equal(f.draft.step,"appearance");
 await f.action(appearanceBack,[String(f.draft.revision)]);
 await f.action(overviewAction,[String(f.draft.revision),"save"]);
 assert.equal(f.profile.region,null);
 assert.equal(f.profile.area,null);
});
test("Hokkaido and Okinawa single-child blocks toggle immediately",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 await f.action(areaOpen,[String(f.draft.revision)]);
 await f.action(regionAction,[String(f.draft.revision),"0"]);
 assert.equal(f.draft.step,"area-blocks");
 assert.equal(f.draft.data.region,"北海道");
 assert.equal(f.draft.data.area,"北海道");
 await f.action(regionAction,[String(f.draft.revision),"0"]);
 assert.equal(f.draft.data.region,null);
 await f.action(regionAction,[String(f.draft.revision),"12"]);
 assert.equal(f.draft.data.area,"沖縄");
});
test("selected region is restored after leaving and reopening area wizard",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"appearance"]);
 await f.action(areaOpen,[String(f.draft.revision)]);
 await f.action(regionAction,[String(f.draft.revision),"5"]);
 await f.action(subAreaAction,[String(f.draft.revision),"1"]);
 const rev=f.draft.revision;
 await f.start();
 assert.equal(f.draft.revision,rev);
 assert.equal(f.draft.step,"area-children");
 assert.equal(f.draft.data.area,"新宿");
 assert.equal(f.sent.filter(x=>x[0]==="reply").length,1);
 await f.action(areaBack,[String(f.draft.revision)]);
 await f.action(areaBack,[String(f.draft.revision)]);
 await f.action(appearanceBack,[String(f.draft.revision)]);
 await f.action(overviewAction,[String(f.draft.revision),"save"]);
 assert.equal(f.profile.region,"東京");
 assert.equal(f.profile.area,"新宿");
});

test("③ one Back button accepts PR and Telegram-only photo/video file refs",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"media"]);
 assert.equal(f.draft.step,"media");
 assert.deepEqual(f.sent.at(-1)[2].reply_markup.inline_keyboard.map((row:any[])=>row.map((b:any)=>b.text)),[["↩ 戻る"]]);
 await f.send("自由な自己紹介");
 assert.equal(f.draft.data.pr,"自由な自己紹介");
 const photo=f.ctx();
 photo.message={message_id:500,photo:[{file_id:"telegram-photo-ref"}]} as any;
 await f.handlers.get("on:photo")!(photo,async()=>{throw Error("photo leaked");});
 const video=f.ctx();
 video.message={message_id:501,video:{file_id:"telegram-video-ref"}} as any;
 await f.handlers.get("on:video")!(video,async()=>{throw Error("video leaked");});
 assert.deepEqual(f.draft.data.media.map((x:any)=>[x.type,x.fileId,x.sourceMessageId]),[
  ["photo","telegram-photo-ref",500],["video","telegram-video-ref",501],
 ]);
 assert.equal(f.sent.filter((x:any)=>x[0]==="reply").length,1);
 await f.action(String.raw`^pf:media:(\d+):back$`,[String(f.draft.revision)]);
 assert.equal(f.draft.step,"preview");
 await f.action(overviewAction,[String(f.draft.revision),"save"]);
 assert.equal(f.profile.pr,"自由な自己紹介");
 assert.equal(f.profile.media.length,2);
});

test("③ new PR replaces the old text and PR削除 clears both body and external reference",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"media"]);
 await f.send("最初の自己PR");
 assert.equal(f.draft.data.pr,"最初の自己PR");
 await f.send("新しい自己PR");
 assert.equal(f.draft.data.pr,"新しい自己PR");
 await f.send("PR削除");
 assert.equal(f.draft.data.pr,null);
 assert.equal(f.draft.data.prRef,null);
 assert.match(f.sent.at(-1)[4],/未登録/);
 assert.deepEqual(f.sent.at(-1)[5].reply_markup.inline_keyboard.map((r:any[])=>r.map((b:any)=>b.text)),[["↩ 戻る"]]);
});

test("③ photo/video item replacement and deletion preserve other item numbers and one-screen UI",async()=>{
 const f=fixture();
 await f.start();
 await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"media"]);
 const sendMedia=async(kind:"photo"|"video",id:number,ref:string)=>{
  const c=f.ctx();
  c.message={message_id:id,...(kind==="photo"?{photo:[{file_id:ref}]}:{video:{file_id:ref}})} as any;
  await f.handlers.get("on:"+kind)!(c,async()=>{throw Error("media leaked");});
 };
 await sendMedia("photo",500,"photo-1");
 await sendMedia("video",501,"video-2");
 assert.deepEqual(f.draft.data.media.map((x:any)=>x.itemId),[1,2]);
 await f.send("差替 1");
 assert.equal(f.draft.data.replaceMediaId,1);
 await sendMedia("photo",502,"photo-new");
 assert.equal(f.draft.data.replaceMediaId,undefined);
 assert.deepEqual(f.draft.data.media.map((x:any)=>[x.itemId,x.fileId]),[[1,"photo-new"],[2,"video-2"]]);
 await f.send("削除 2");
 assert.deepEqual(f.draft.data.media.map((x:any)=>x.itemId),[1]);
 await f.send("削除 2");
 assert.deepEqual(f.draft.data.media.map((x:any)=>x.itemId),[1]);
 assert.match(f.sent.at(-1)[4],/登録されていません/);
 await sendMedia("photo",503,"third-new");
 assert.deepEqual(f.draft.data.media.map((x:any)=>x.itemId),[1,3],"deleted number must not be recycled");
 await f.send("差替 1");
 await f.send("差替取消");
 assert.equal(f.draft.data.replaceMediaId,undefined);
 await f.action(String.raw`^pf:media:(\d+):back$`,[String(f.draft.revision)]);
 await f.action(overviewAction,[String(f.draft.revision),"save"]);
 assert.deepEqual(f.profile.media.map((x:any)=>[x.itemId,x.fileId]),[[1,"photo-new"],[3,"third-new"]]);
 assert.equal(f.profile.mediaNextId,4);
 assert.equal(f.sent.filter((x:any)=>x[0]==="reply").length,1);
});

test("③ replacement waits for media and cannot overwrite PR with an accidental text",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"media"]);
 await f.send("最初の自己PR");
 const c=f.ctx();c.message={message_id:600,photo:[{file_id:"original"}]} as any;
 await f.handlers.get("on:photo")!(c,async()=>{throw Error("media leaked");});
 await f.send("差替 1");
 await f.send("間違った文章");
 assert.equal(f.draft.data.pr,"最初の自己PR");
 assert.equal(f.draft.data.replaceMediaId,1);
});

test("③ large media lists remain viewable via text pagination without extra buttons or item cap",async()=>{
 const f=fixture();
 await f.start();await f.send("ゼロ\n175 80 40");
 await f.action(positionAction,[String(f.draft.revision),"0"]);
 await f.action(overviewAction,[String(f.draft.revision),"media"]);
 for(let n=0;n<41;n++){
  const ctx=f.ctx();
  ctx.message={message_id:1000+n,photo:[{file_id:"file-"+n}]} as any;
  await f.handlers.get("on:photo")!(ctx,async()=>{throw Error("media leaked");});
 }
 assert.equal(f.draft.data.media.length,41);
 await f.send("一覧 2");
 assert.equal(f.draft.data.mediaPage,2);
 assert.match(f.sent.at(-1)[4],/No.41/);
 assert.ok(!String(f.sent.at(-1)[4]).includes("No.1 🖼️"));
 await f.send("一覧 99");
 assert.equal(f.draft.data.mediaPage,2);
 assert.match(f.sent.at(-1)[4],/存在しない一覧ページ/);
 assert.deepEqual(f.sent.at(-1)[5].reply_markup.inline_keyboard.map((r:any[])=>r.map((b:any)=>b.text)),[["↩ 戻る"]]);
});

const tagOverview=String.raw`^pf:overview:(\\d+):(basic|appearance|media|like|love|preview|save|cancel)$`;
for(const purpose of ["like","love"] as const){
 const prefix="^pf:"+purpose+":";
 test(purpose+" category-to-candidate-to-save, reopening shows persisted purpose",async()=>{
  const f=fixture();
  await f.start();await f.send("ゼロ\\n175 80 40");
  await f.action(positionAction,[String(f.draft.revision),"0"]);
  await f.action(tagOverview,[String(f.draft.revision),purpose]);
  assert.equal(f.draft.step,"like-categories");
  assert.match(f.sent.at(-1)[1],purpose==="like"?/自分/:/相手/);
  const parent=f.sent.at(-1)[2].reply_markup.inline_keyboard;
  assert.deepEqual(parent.map((r:any[])=>r.length),[3,3,2]);
  assert.equal(parent[2][1].text,"保存");
  await f.action(prefix+String.raw`(\\d+):open:([0-5])$`,[String(f.draft.revision),"1"]);
  assert.equal(f.draft.step,"like-items");
  await f.action(prefix+String.raw`(\\d+):tag:([0-5]):(\\d{1,2})$`,[String(f.draft.revision),"1","0"]);
  assert.equal(f.draft.data[purpose+"Tags"].length,1);
  const rev=f.draft.revision;
  await f.action(prefix+String.raw`(\\d+):tag:([0-5]):(\\d{1,2})$`,[String(f.draft.revision),"1","0"]);
  assert.equal(f.draft.data[purpose+"Tags"].length,0);
  await f.action(prefix+String.raw`(\\d+):tag:([0-5]):(\\d{1,2})$`,[String(f.draft.revision),"1","0"]);
  await f.action(prefix+String.raw`(\\d+):page:([0-5]):(-?\\d{1,2})$`,[String(f.draft.revision),"1","1"]);
  assert.equal(f.draft.data.likePage,1);
  assert.equal(f.draft.data[purpose+"Tags"].length,1);
  await f.action(prefix+String.raw`(\\d+):page:([0-5]):(-?\\d{1,2})$`,[String(f.draft.revision),"1","0"]);
  await f.action(prefix+String.raw`(\\d+):back$`,[String(f.draft.revision)]);
  assert.equal(f.draft.step,"like-categories");
  await f.action(prefix+String.raw`(\\d+):open:([0-5])$`,[String(f.draft.revision),"5"]);
  await f.action(prefix+String.raw`(\\d+):tag:([0-5]):(\\d{1,2})$`,[String(f.draft.revision),"5","0"]);
  assert.equal(f.draft.data[purpose+"Tags"].length,2);
  await f.action(prefix+String.raw`(\\d+):clear:([0-5])$`,[String(f.draft.revision),"5"]);
  assert.equal(f.draft.data[purpose+"Tags"].length,1);
  const oldRev=String(f.draft.revision);
  await f.action(prefix+String.raw`(\\d+):save$`,[String(f.draft.revision)]);
  assert.equal(f.profile.status,"private");
  assert.deepEqual(f.profile[purpose+"Tags"],[{category:"パーツ",tag:"乳首"}]);
  assert.equal(f.draft.step,"preview");
  await f.action(prefix+String.raw`(\\d+):save$`,[oldRev]);
  assert.deepEqual(f.profile[purpose+"Tags"],[{category:"パーツ",tag:"乳首"}]);
  assert.match(String(f.sent.at(-1)[1]),/古い/);
 });
}
