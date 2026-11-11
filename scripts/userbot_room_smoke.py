#!/usr/bin/env python3
"""Real Telegram DM regression: /start -> Room editor -> input -> cancel.

Uses the already authorized local Telethon session, without phone login.
Never posts to any group or creates a meeting. Run with the Userbot service
temporarily stopped and restart it in a finally/trap outside this script.
"""
from __future__ import annotations

import asyncio
from telethon import TelegramClient
from userbot_session import SESSION_BASE, load_credentials

BOT = "GayBBS_bot"
TEST_TITLE = "E2E動作検証（未投稿）"
TEST_TEXT_MANUAL = TEST_TITLE + "\nE2Eテスト\n170 70 30\n公開せず入力プレビューを確認する検証"
TEST_TEXT_LINKED = TEST_TITLE + "\n公開せず入力プレビューを確認する検証"


async def get_screen(client, bot, required_label=None):
    for _ in range(12):
        messages = await client.get_messages(bot, limit=15)
        candidates = [m for m in messages if not m.out and m.buttons]
        if required_label:
            candidates = [m for m in candidates
                          if required_label in [b.text for row in m.buttons for b in row]]
        if candidates:
            return candidates[0]
        await asyncio.sleep(1)
    raise RuntimeError("EXPECTED_TELEGRAM_SCREEN_NOT_FOUND:" + str(required_label))


async def run():
    api_id, api_hash = load_credentials()
    async with TelegramClient(str(SESSION_BASE), api_id, api_hash) as client:
        if not await client.is_user_authorized():
            raise RuntimeError("USERBOT_SESSION_UNAUTHORIZED")
        bot = await client.get_entity(BOT)
        if not bot.bot:
            raise RuntimeError("TELEGRAM_TARGET_NOT_BOT")
        previous = await client.get_messages(bot, limit=1)
        start_before = previous[0].id if previous else 0
        await client.send_message(bot, "/start")
        for _ in range(12):
            messages = await client.get_messages(bot, limit=12)
            menu = next((m for m in messages if m.id > start_before and not m.out and m.buttons
                         and any(b.text == "募集+Room" for row in m.buttons for b in row)), None)
            if menu:
                break
            await asyncio.sleep(1)
        else:
            raise RuntimeError("TELEGRAM_START_MENU_MISSING")
        layout = [[b.text for b in row] for row in menu.buttons]
        expected = [
            ["相手募集", "募集+Room", "告知/予告"],
            ["プロフ作成", "クリエーター有料ビデオ投稿"],
            ["🔗ボタン作成", "検索/フィルター"],
            ["雑談", "紹介/招待", "操作説明"],
        ]
        if layout != expected:
            raise RuntimeError("POSTING_MENU_CONTRACT_MISMATCH")
        print("E2E_START_MENU_PASS", flush=True)
        entered = False
        try:
            await menu.click(text="募集+Room")
            method = await get_screen(client, bot, "Room作成")
            entered = True
            print("E2E_ROOM_METHOD_PICKER_PASS", flush=True)
            await method.click(text="Room作成")
            # The next step must be the adopted recruitment text-input
            # contract, for a linked or profile-less applicant.
            for _ in range(12):
                messages = await client.get_messages(bot, limit=12)
                guide = next((m for m in messages if not m.out and
                              ("1行目" in (m.raw_text or "")) and
                              ("募集+Room" in (m.raw_text or ""))), None)
                if guide:
                    break
                await asyncio.sleep(1)
            else:
                raise RuntimeError("ROOM_SHARED_INPUT_GUIDE_MISSING")
            linked = ("2行目以降" in guide.raw_text and
                      "3行目" not in guide.raw_text and
                      "ニックネーム" not in guide.raw_text)
            payload = TEST_TEXT_LINKED if linked else TEST_TEXT_MANUAL
            input_message = await client.send_message(bot, payload)
            for _ in range(12):
                await asyncio.sleep(1)
                messages = await client.get_messages(bot, limit=15)
                preview = next((m for m in messages if not m.out and
                                TEST_TITLE in (m.raw_text or "") and m.buttons), None)
                if preview:
                    print("E2E_ROOM_INPUT_PREVIEW_PASS", flush=True)
                    remaining = await client.get_messages(bot, ids=input_message.id)
                    if remaining is not None:
                        raise RuntimeError("ROOM_WIZARD_INPUT_NOT_DELETED")
                    print("E2E_ROOM_INPUT_DELETED_PASS", flush=True)
                    break
            else:
                raise RuntimeError("ROOM_INPUT_PREVIEW_NOT_UPDATED")
        finally:
            if entered:
                messages = await client.get_messages(bot, limit=15)
                cancel = next((m for m in messages if not m.out and m.buttons and
                               any(b.text == "キャンセル" for row in m.buttons for b in row)
                               and ("募集+Room" in (m.raw_text or "") or TEST_TITLE in (m.raw_text or ""))), None)
                if cancel:
                    # A pre-existing /start menu is NOT proof of cancellation.
                    before_cancel = await client.get_messages(bot, limit=1)
                    cursor = before_cancel[0].id if before_cancel else 0
                    await cancel.click(text="キャンセル")
                    for _ in range(12):
                        await asyncio.sleep(1)
                        current = await client.get_messages(bot, ids=cancel.id)
                        recent = await client.get_messages(bot, limit=8)
                        candidates = ([current] if current else []) + [
                            m for m in recent if not m.out and m.id > cursor
                        ]
                        def restored_menu(message):
                            if message is None or not message.buttons:
                                return False
                            labels = [[b.text for b in row] for row in message.buttons]
                            return labels == expected
                        if any(restored_menu(message) for message in candidates):
                            print("E2E_ROOM_CANCEL_MENU_RESTORED_PASS", flush=True)
                            break
                    else:
                        raise RuntimeError("ROOM_CANCEL_MENU_NOT_RESTORED")


if __name__ == "__main__":
    asyncio.run(run())
