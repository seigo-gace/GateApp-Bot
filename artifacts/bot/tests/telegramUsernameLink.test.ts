import test from "node:test";
import assert from "node:assert/strict";
import {publicUsernameLink,ownerUsernameLink} from "../src/services/telegramUsernameLink.js";

test("recruitment contact links straight to the owner's Telegram username",()=>{
 assert.equal(publicUsernameLink("Example_User"),"https://t.me/Example_User");
 assert.equal(publicUsernameLink("@Example_User"),"https://t.me/Example_User");
 assert.doesNotMatch(publicUsernameLink("Example_User"),/\?start=|GayBBS_bot/);
});
test("do not publish guessed or invalid contact destinations",()=>{
 for(const name of [null,"","a","bad/name","http://bad","@bad\ntext",42])
  assert.throws(()=>publicUsernameLink(name),/USERNAME_REQUIRED/);
});
test("fetch the Telegram owner's current username, not a stale draft label",async()=>{
 const telegram={getChat:async(id:number)=>{assert.equal(id,123);return {username:"Live_Owner"};}};
 assert.equal(await ownerUsernameLink(telegram as never,123),"https://t.me/Live_Owner");
});
