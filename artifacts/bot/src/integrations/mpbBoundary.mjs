/**
 * TGtumbler G1/G2: approval boundary for existing MPB publisher.
 * Reuse legacy -AdminSystem/server/modules/multipost/{core,dispatcher,store}.
 * This module deliberately has no network, storage, or Telegram side effects.
 */
export function validateMpbTarget(target) {
  if (!target || target.verified !== true || target.allowed !== true || target.canPost !== true) {
    throw new Error("DESTINATION_NOT_VERIFIED");
  }
  if (!Number.isSafeInteger(target.chatId) || target.chatId === 0 ||
      !Number.isSafeInteger(target.threadId) || target.threadId <= 0 ||
      typeof target.destinationKey !== "string" || target.destinationKey.length === 0) {
    throw new Error("INVALID_MPB_TARGET");
  }
  return Object.freeze({
    chatId: target.chatId, threadId: target.threadId,
    destinationKey: target.destinationKey,
  });
}

export function prepareMpbCommand(input, deps) {
  if (!input || !deps || typeof deps.resolveDestination !== "function" ||
      typeof deps.canAct !== "function") throw new Error("MPB_DEPENDENCIES_MISSING");
  if (!["publish", "revise", "cancel"].includes(input.action) ||
      !Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0 ||
      !Number.isSafeInteger(input.revision) || input.revision <= 0 ||
      !input.requestId || !input.sourceType || !input.sourceId) {
    throw new Error("INVALID_MPB_COMMAND");
  }
  // No client-supplied Telegram destinations; resolve the origin on server.
  if (input.chatId !== undefined || input.threadId !== undefined ||
      input.targets !== undefined || input.target !== undefined) {
    throw new Error("CLIENT_DESTINATION_FORBIDDEN");
  }
  const target = validateMpbTarget(deps.resolveDestination({
    originToken: input.originToken, actorUserId: input.actorUserId,
    sourceType: input.sourceType, sourceId: input.sourceId,
  }));
  if (deps.canAct({actorUserId: input.actorUserId, sourceType: input.sourceType,
      sourceId: input.sourceId, destinationKey: target.destinationKey,
      action: input.action}) !== true) throw new Error("MPB_PERMISSION_DENIED");
  if (input.action !== "publish" &&
      (!Number.isSafeInteger(input.messageId) || input.messageId <= 0)) {
    throw new Error("BOUND_MESSAGE_REQUIRED");
  }
  if (input.action !== "cancel" &&
      (typeof input.text !== "string" || input.text.trim().length === 0)) {
    throw new Error("MPB_TEXT_REQUIRED");
  }
  return Object.freeze({
    action: input.action, actorUserId: input.actorUserId,
    sourceType: input.sourceType, sourceId: input.sourceId,
    requestId: input.requestId, revision: input.revision, ...target,
    ...(input.action === "publish" ? {} : {messageId: input.messageId}),
    ...(input.action === "cancel" ? {} : {text: input.text}),
  });
}

// The real GroupBot repositories resolve destinations and authorization
// asynchronously via PostgreSQL. Resolve both before the existing sync
// validation, and reject both pending promises and non-boolean permission.
export async function prepareMpbCommandAsync(input, deps) {
  if (!deps || typeof deps.resolveDestination !== "function" ||
      typeof deps.canAct !== "function") {
    throw new Error("MPB_DEPENDENCIES_MISSING");
  }
  if (!input || typeof input !== "object") throw new Error("INVALID_MPB_COMMAND");
  const target = await deps.resolveDestination({
    originToken: input.originToken, actorUserId: input.actorUserId,
    sourceType: input.sourceType, sourceId: input.sourceId,
  });
  const checked = validateMpbTarget(target);
  const allowed = await deps.canAct({
    actorUserId: input.actorUserId, sourceType: input.sourceType,
    sourceId: input.sourceId, destinationKey: checked.destinationKey,
    action: input.action,
  });
  return prepareMpbCommand(input, {
    resolveDestination: () => target,
    canAct: () => allowed,
  });
}

// The existing MPB, not this adapter, owns idempotency, durable queue,
// publication binding, retry, revision checks, and audit.
export async function executeMpbCommand(input, deps) {
  const command = await prepareMpbCommandAsync(input, deps);
  const fn = deps.existingMpb?.[command.action];
  if (typeof fn !== "function") throw new Error("EXISTING_MPB_NOT_WIRED");
  const result = await fn(command);
  if (!result || result.ok !== true) throw new Error("MPB_NOT_ACKNOWLEDGED");
  return result;
}
