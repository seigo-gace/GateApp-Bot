// TGtumbler: read-only destination validation for the existing multipost module.
// Does not send Telegram requests or alter infrastructure.
export function validateMpbTarget(target) {
  if (!target || target.verified !== true || target.allowed !== true) {
    throw new Error("DESTINATION_NOT_VERIFIED");
  }
  if (!Number.isSafeInteger(target.chatId) || target.chatId === 0 ||
      !Number.isSafeInteger(target.threadId) || target.threadId <= 0) {
    throw new Error("INVALID_MPB_TARGET");
  }
  return Object.freeze({chatId: target.chatId, threadId: target.threadId});
}
