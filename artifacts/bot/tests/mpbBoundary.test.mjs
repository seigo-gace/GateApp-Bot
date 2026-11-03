import test from "node:test";
import assert from "node:assert/strict";
import { validateMpbTarget, prepareMpbCommand, executeMpbCommand } from "../src/integrations/mpbBoundary.mjs";

const input = () => ({
  action: "publish", actorUserId: 12345, revision: 1,
  sourceType: "profile", sourceId: "profile-12", requestId: "publish-12",
  originToken: "opaque-start-token", text: "Approved profile"
});
const deps = () => ({
  resolveDestination: ({originToken}) => {
    assert.equal(originToken, "opaque-start-token");
    return {verified: true, allowed: true, canPost: true,
      chatId: -1001234567890, threadId: 321, destinationKey: "topic:approved"};
  },
  canAct: () => true,
  existingMpb: {publish: async () => ({ok: true, post_id: "existing-mpb-id"})},
});

test("approved origin resolves one immutable destination", () => {
  const command = prepareMpbCommand(input(), deps());
  assert.deepEqual(validateMpbTarget(deps().resolveDestination({originToken:"opaque-start-token"})), {
    chatId: -1001234567890, threadId: 321, destinationKey: "topic:approved",
  });
  assert.equal(command.chatId, -1001234567890);
  assert.equal(command.threadId, 321);
  assert.ok(Object.isFrozen(command));
});

test("client destinations are forbidden", () => {
  assert.throws(() => prepareMpbCommand({...input(), threadId: 999}, deps()), /CLIENT_DESTINATION_FORBIDDEN/);
  assert.throws(() => prepareMpbCommand({...input(), targets: []}, deps()), /CLIENT_DESTINATION_FORBIDDEN/);
});

test("unknown or nonwritable targets fail closed", () => {
  for (const target of [null, {verified: false}, {verified: true, allowed: true, canPost: false},
    {verified: true, allowed: true, canPost: true, chatId: -1001, threadId: 0, destinationKey: "x"}]) {
    assert.throws(() => prepareMpbCommand(input(), {
      ...deps(), resolveDestination: () => target,
    }), /DESTINATION_NOT_VERIFIED|INVALID_MPB_TARGET/);
  }
});

test("ownership is enforced before publication", () => {
  assert.throws(() => prepareMpbCommand(input(), {...deps(), canAct: () => false}), /MPB_PERMISSION_DENIED/);
});

test("revisions and cancellations require a bound message", () => {
  for (const action of ["revise", "cancel"]) {
    assert.throws(() => prepareMpbCommand({...input(), action}, deps()), /BOUND_MESSAGE_REQUIRED/);
    const command = prepareMpbCommand({...input(), action, messageId: 55}, deps());
    assert.equal(command.messageId, 55);
  }
});

test("existing publisher is required and no second publisher is created", async () => {
  await assert.rejects(executeMpbCommand(input(), {...deps(), existingMpb: null}), /EXISTING_MPB_NOT_WIRED/);
  await assert.rejects(executeMpbCommand(input(), {...deps(), existingMpb: {
    publish: async () => ({ok: false}),
  }}), /MPB_NOT_ACKNOWLEDGED/);
  assert.deepEqual(await executeMpbCommand(input(), deps()), {ok: true, post_id: "existing-mpb-id"});
});

test("invalid actor, revision and missing content fail closed", () => {
  assert.throws(() => prepareMpbCommand({...input(), actorUserId: 0}, deps()), /INVALID_MPB_COMMAND/);
  assert.throws(() => prepareMpbCommand({...input(), revision: 0}, deps()), /INVALID_MPB_COMMAND/);
  assert.throws(() => prepareMpbCommand({...input(), text: ""}, deps()), /MPB_TEXT_REQUIRED/);
});
