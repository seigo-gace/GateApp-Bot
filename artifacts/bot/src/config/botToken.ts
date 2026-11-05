import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

// One Telegram Bot Token reader for the existing GroupBot and @GayBBS_bot.
// The actual token is unique per Bot; Gserver's Bot-only API bearer is unrelated.
const BOT_TOKEN_FORMAT = /^[0-9]{7,15}:[A-Za-z0-9_-]{30,100}$/;

function validateBotToken(value: string): string {
  if (!BOT_TOKEN_FORMAT.test(value)) throw new Error("BOT_TOKEN_INVALID");
  return value;
}

export function readBotTokenSecret(path: string): string {
  if (!isAbsolute(path) || normalize(path) !== path) throw new Error("BOT_TOKEN_FILE_PATH_UNSAFE");
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o077) !== 0 ||
      before.size < 30 || before.size > 256 || before.nlink !== 1) {
    throw new Error("BOT_TOKEN_FILE_UNSAFE");
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = fstatSync(fd);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino ||
        (after.mode & 0o077) !== 0 || after.size < 30 || after.size > 256 ||
        after.nlink !== 1) {
      throw new Error("BOT_TOKEN_FILE_UNSAFE");
    }
    // Docker secret content is the raw token, not a BOT_TOKEN=.env assignment.
    return validateBotToken(readFileSync(fd, "utf8").trim());
  } finally {
    closeSync(fd);
  }
}

export function readConfiguredBotToken(
  env: Pick<NodeJS.ProcessEnv, "BOT_TOKEN" | "BOT_TOKEN_FILE"> = process.env,
): string {
  if (env.BOT_TOKEN_FILE !== undefined) {
    if (env.BOT_TOKEN !== undefined) throw new Error("BOT_TOKEN_SOURCES_CONFLICT");
    const path = env.BOT_TOKEN_FILE;
    if (!path.startsWith("/run/secrets/") || normalize(path) !== path) {
      throw new Error("BOT_TOKEN_FILE_PATH_UNSAFE");
    }
    return readBotTokenSecret(path);
  }
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN_REQUIRED");
  return validateBotToken(env.BOT_TOKEN);
}
