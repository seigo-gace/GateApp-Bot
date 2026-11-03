import test from "node:test";
import assert from "node:assert/strict";
import { createLegacyMpbPort } from "../src/integrations/mpbLegacyPort.mjs";
import { executeMpbCommand } from "../src/integrations/mpbBoundary.mjs";

const command = (action = "publish") => ({
  action, actorUserId: 12345, revision: 2,
  sourceType: "profile", sourceId: "profile-12", requestId: "request-12",
  originToken: "opaque-token", text: "A permitted post",
  ...(action === "publish" ? {} : {messageId: 501})
});
const authorization = (existingMpb) => ({
  resolveDestination: () => ({
    verified: true, allowed: true, canPost: true,
    chatId: -100100, threadId: 42, destinationKey: "topic:42"
  }),
  canAct: () => true,
  existingMpb,
});
const createFixture = (override = {}) => {
  const calls = [];
  const deps = {
    durableReady: true,
    handle: async (payload, legacyDeps) => {
      calls.push(["handle", payload, legacyDeps]);
      return {ok: true, post_id: "legacy:1", message_id: 501};
    },
    legacyDeps: {store: "existing-durable-store"},
    findBinding: async () => ({
      actorUserId: 12345, chatId: -100100, threadId: 42,
      messageId: 501, state: "active",
    }),
    verifyRevision: async () => true,
    dispatcher: {
      editMessage: async (...args) => { calls.push(["edit", ...args]); },
      deleteMessage: async (...args) => { calls.push(["delete", ...args]); },
    },
    ...override,
  };
  return {calls, deps};
};
test("legacy MPB gets the exact approved destination through core.handle", async () => {
  const {calls, deps} = createFixture();
  const result = await executeMpbCommand(command(), authorization(createLegacyMpbPort(deps)));
  assert.equal(result.postId, "legacy:1");
  assert.deepEqual(calls[0][1], {
    request_id: "request-12", type: "text",
    targets: [{chat_id: -100100, thread_id: 42}],
    content: {text: "A permitted post"},
    schedule: {mode: "immediate"},
  });
  assert.equal(calls[0][2], deps.legacyDeps);
});
test("no persistent backing means no existing engine port", () => {
  assert.throws(() => createLegacyMpbPort(createFixture({durableReady: false}).deps),
    /MPB_DURABLE_BINDING_NOT_READY/);
});
test("unconfirmed delivery never returns a false publish PASS", async () => {
  const {deps} = createFixture({handle: async () => ({ok: true, post_id: "x", message_id: null})});
  await assert.rejects(executeMpbCommand(command(), authorization(createLegacyMpbPort(deps))),
    /MPB_PUBLISH_UNCONFIRMED/);
});
test("revision uses the same bound Telegram message, never another source", async () => {
  const {calls, deps} = createFixture();
  const result = await executeMpbCommand(command("revise"), authorization(createLegacyMpbPort(deps)));
  assert.equal(result.messageId, 501);
  assert.deepEqual(calls[0], [
    "edit", {chat_id: -100100, thread_id: 42}, 501,
    {text: "A permitted post", disable_preview: true},
  ]);
});
test("cancel needs the same binding and does not create replacement posts", async () => {
  const {calls, deps} = createFixture();
  await executeMpbCommand(command("cancel"), authorization(createLegacyMpbPort(deps)));
  assert.deepEqual(calls[0], ["delete", {chat_id: -100100, thread_id: 42}, 501]);
});
test("wrong bound owner, thread or message fails before invoking dispatcher", async () => {
  for (const patch of [
    {actorUserId: 8}, {chatId: -100200}, {threadId: 99},
    {messageId: 502}, {state: "deleted"},
  ]) {
    const {calls, deps} = createFixture({
      findBinding: async () => ({
        actorUserId: 12345, chatId: -100100, threadId: 42,
        messageId: 501, state: "active", ...patch,
      }),
    });
    await assert.rejects(executeMpbCommand(command("revise"),
      authorization(createLegacyMpbPort(deps))), /MPB_BINDING_MISMATCH/);
    assert.equal(calls.length, 0);
  }
});
test("stale revision never edits external Telegram", async () => {
  const {calls, deps} = createFixture({verifyRevision: async () => false});
  await assert.rejects(executeMpbCommand(command("revise"),
    authorization(createLegacyMpbPort(deps))), /MPB_REVISION_NOT_CURRENT/);
  assert.equal(calls.length, 0);
});
