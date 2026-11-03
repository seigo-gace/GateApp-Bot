/**
 * G1/G2 adapter for the pre-existing -AdminSystem multipost engine.
 *
 * Does not fork the old MPB core: injected "handle" is the actual legacy
 * core.handle(payload, deps), and dispatcher is its Telegraf dispatcher.
 * No Bot startup, network configuration, or second queue.
 *
 * This bridge is not a production-ready durable store. Callers must attach
 * an existing persistent store with transactional request-id and revision
 * guards before enabling Telegram delivery.
 */
export function createLegacyMpbPort({ handle, legacyDeps, findBinding, verifyRevision, dispatcher, durableReady }) {
  if (durableReady !== true || typeof handle !== "function" ||
      !legacyDeps || typeof findBinding !== "function" ||
      typeof verifyRevision !== "function" ||
      typeof dispatcher?.editMessage !== "function" ||
      typeof dispatcher?.deleteMessage !== "function") {
    throw new Error("MPB_DURABLE_BINDING_NOT_READY");
  }

  async function bound(command) {
    const binding = await findBinding({
      sourceType: command.sourceType,
      sourceId: command.sourceId,
      destinationKey: command.destinationKey,
    });
    if (!binding || binding.actorUserId !== command.actorUserId ||
        binding.chatId !== command.chatId || binding.threadId !== command.threadId ||
        binding.state !== "active" || !Number.isSafeInteger(binding.messageId) ||
        binding.messageId <= 0 || binding.messageId !== command.messageId) {
      throw new Error("MPB_BINDING_MISMATCH");
    }
    if (await verifyRevision({ command, binding }) !== true) {
      throw new Error("MPB_REVISION_NOT_CURRENT");
    }
    return binding;
  }

  return Object.freeze({
    async publish(command) {
      // The legacy module owns validation, dedupe, persistence and audit.
      const result = await handle({
        request_id: command.requestId,
        type: "text",
        targets: [{chat_id: command.chatId, thread_id: command.threadId}],
        content: {text: command.text},
        schedule: {mode: "immediate"},
      }, legacyDeps);
      if (!result?.ok || !result.post_id ||
          !Number.isSafeInteger(result.message_id) || result.message_id <= 0) {
        throw new Error("MPB_PUBLISH_UNCONFIRMED");
      }
      return {ok: true, postId: result.post_id, messageId: result.message_id,
        deduped: result.deduped === true};
    },

    async revise(command) {
      await bound(command);
      await dispatcher.editMessage(
        {chat_id: command.chatId, thread_id: command.threadId},
        command.messageId,
        {text: command.text, disable_preview: true}
      );
      // External Telegram edit is not a database commit. The owning service
      // must persist revision, audit and uncertain-ack recovery separately.
      return {ok: true, messageId: command.messageId, revision: command.revision};
    },

    async cancel(command) {
      await bound(command);
      await dispatcher.deleteMessage(
        {chat_id: command.chatId, thread_id: command.threadId},
        command.messageId
      );
      return {ok: true, messageId: command.messageId, revision: command.revision};
    },
  });
}
