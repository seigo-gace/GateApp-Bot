import test from "node:test";
import assert from "node:assert/strict";
import {invitationMenu, invitationText, invitationCopyButton} from "../src/services/communityInviteMenu.js";
import type {CommunityInviteChoice} from "../src/modules/gaybbsApproval/handlers.js";

const boards:CommunityInviteChoice[]=[
 {label:"エリア’s BBS",chatId:-1003847210571,
  gateUrl:"https://t.me/GayBBS_bot?start=gate_ee538b32b74f",
  directUrl:"https://t.me/c/3847210571/1",joined:true},
 {label:"ビデオChatの掲示板",chatId:-1002373696859,
  gateUrl:"https://t.me/GayBBS_bot?start=gate_6f581d52e546",
  directUrl:"https://t.me/c/2373696859/1",joined:false},
 {label:"ゲイのための掲示板♂",chatId:-1003770334893,
  gateUrl:"https://t.me/GayBBS_bot?start=gate_e31b8d1dd707",
  directUrl:"https://t.me/c/3770334893/1",joined:true},
];

test("unapproved user gets only three Gate links; copy is Telegram native copy_text",()=>{
 const keyboard=invitationMenu(false,boards).reply_markup.inline_keyboard;
 assert.deepEqual(keyboard.map(row=>row.length),[2,2,2,1]);
 for(let i=0;i<3;i++){
  assert.equal("url" in keyboard[i]![0]! && keyboard[i]![0]!.url,boards[i]!.gateUrl);
  assert.deepEqual("copy_text" in keyboard[i]![1]! && keyboard[i]![1]!.copy_text,
   {text:boards[i]!.gateUrl});
 }
 assert.equal("callback_data" in keyboard[3]![0]! && keyboard[3]![0]!.callback_data,"dm:chat-back");
 assert.match(invitationText(false),/承認質問/);
});

test("approved member opens joined boards, pending board remains Gate, copy always shares Gate",()=>{
 const keyboard=invitationMenu(true,boards).reply_markup.inline_keyboard;
 assert.equal("url" in keyboard[0]![0]! && keyboard[0]![0]!.url,boards[0]!.directUrl);
 assert.equal("url" in keyboard[1]![0]! && keyboard[1]![0]!.url,boards[1]!.gateUrl);
 assert.equal("url" in keyboard[2]![0]! && keyboard[2]![0]!.url,boards[2]!.directUrl);
 for(let i=0;i<3;i++)
  assert.equal("copy_text" in keyboard[i]![1]! && keyboard[i]![1]!.copy_text?.text,boards[i]!.gateUrl);
 assert.match(invitationText(true),/承認済み/);
});

test("copy URLs are restricted to the actual GayBBS Gate and complete 3-board list",()=>{
 assert.throws(()=>invitationCopyButton("copy","https://t.me/c/3847210571/1"),/INVALID/);
 assert.throws(()=>invitationMenu(false,boards.slice(0,2)),/THREE_BOARD/);
 assert.throws(()=>invitationMenu(false,[boards[0]!,boards[0]!,boards[2]!]),/THREE_BOARD/);
});
