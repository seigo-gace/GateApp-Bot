import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBotTokenSecret, readConfiguredBotToken } from "../src/config/botToken.js";

const TOKEN = "123456789:" + "A".repeat(36);

test("GroupBot and GayBBS use one token interface and never share token values implicitly", () => {
  assert.equal(readConfiguredBotToken({BOT_TOKEN: TOKEN}), TOKEN);
  assert.throws(() => readConfiguredBotToken({}), /BOT_TOKEN_REQUIRED/);
  assert.throws(() => readConfiguredBotToken({BOT_TOKEN: "bad"}), /BOT_TOKEN_INVALID/);
  assert.throws(() => readConfiguredBotToken({BOT_TOKEN: TOKEN, BOT_TOKEN_FILE: "/run/secrets/gaybbs"}), /BOT_TOKEN_SOURCES_CONFLICT/);
  assert.throws(() => readConfiguredBotToken({BOT_TOKEN_FILE: "/home/gace/.config/gace/tgtumbler/gaybbs-bot.env"}), /BOT_TOKEN_FILE_PATH_UNSAFE/);
  assert.throws(() => readConfiguredBotToken({BOT_TOKEN_FILE: "/run/secrets/../private"}), /BOT_TOKEN_FILE_PATH_UNSAFE/);
});

test("private raw Docker secret accepts only safe regular files", () => {
  const dir = mkdtempSync(join(tmpdir(), "tgtumbler-bot-token-"));
  try {
    const path = join(dir, "telegram-secret");
    writeFileSync(path, TOKEN + "\n", {mode: 0o600});
    assert.equal(readBotTokenSecret(path), TOKEN);
    chmodSync(path, 0o644);
    assert.throws(() => readBotTokenSecret(path), /BOT_TOKEN_FILE_UNSAFE/);
    chmodSync(path, 0o600);
    writeFileSync(path, "BOT_TOKEN=" + TOKEN + "\n");
    assert.throws(() => readBotTokenSecret(path), /BOT_TOKEN_INVALID/);
    writeFileSync(path, TOKEN + "\n");
    const link = join(dir, "secret-link");
    symlinkSync(path, link);
    assert.throws(() => readBotTokenSecret(link), /BOT_TOKEN_FILE_UNSAFE/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
