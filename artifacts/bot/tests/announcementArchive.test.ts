import test from "node:test";
import assert from "node:assert/strict";
import {archiveAnnouncementText} from "../src/services/announcementArchive.js";

test("keep Telegram message; mark cancelled and finished using existing text",()=>{
 assert.equal(archiveAnnouncementText("📣 募集\n本文","recruitment","closed"),
  "📣 募集\n本文\n状態：✅ 募集終了");
 assert.equal(archiveAnnouncementText("📢 告知\n本文","announcement","expired"),
  "📢 告知\n本文\n状態：📌 掲載終了");
 assert.equal(archiveAnnouncementText("📢 告知\n状態：公開中","announcement","cancelled"),
  "📢 告知\n状態：🚫 中止");
});
