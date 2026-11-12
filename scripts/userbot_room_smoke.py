#!/usr/bin/env python3
"""Private Room DM smoke test executed ONLY by the resident Userbot IPC.

Never opens a TelegramClient, touches a live session file, logs in, restarts the
worker, publishes a Room, or contacts a public group. The CLI delegates to the
existing owner-only resident test client.
"""
from __future__ import annotations

import asyncio
from typing import Any

BOT = "GayBBS_bot"
TEST_TITLE = "E2E動作検証（未投稿）"
TEST_TEXT_MANUAL = TEST_TITLE + "\nE2Eテスト\n170 70 30\n公開せず入力プレビューを確認する検証"
TEST_TEXT_LINKED = TEST_TITLE + "\n公開せず入力プレビューを確認する検証"
EXPECTED_MENU = [
    ["相手募集", "募集+Room", "告知/予告"],
    ["プロフ作成", "クリエーター有料ビデオ投稿"],
    ["🔗ボタン作成", "検索/フィルター"],
    ["雑談", "紹介/招待", "操作説明"],
]


def rows(message: Any) -> list[list[str]]:
    return [[button.text for button in row] for row in (message.buttons or [])]


async def wait_for_screen(client: Any, bot: Any, original_id: int | None,
                          before_id: int, predicate: Any, code: str) -> Any:
    """Observe only the fresh /start screen or its same-ID edits/replacements."""
    for _ in range(10):
        candidates = []
        if original_id is not None:
            original = await client.get_messages(bot, ids=original_id)
            if original is not None:
                candidates.append(original)
        for message in await client.get_messages(bot, limit=15):
            if message.id > before_id:
                candidates.append(message)
        for message in candidates:
            if not message.out and predicate(message):
                return message
        await asyncio.sleep(0.35)
    raise RuntimeError(code)


async def run(client: Any) -> dict[str, Any]:
    """No public post; verify /start → Room draft → preview → input deletion → cancel."""
    bot = await client.get_entity(BOT)
    if not bot.bot:
        raise RuntimeError("ROOM_TEST_TARGET_NOT_BOT")
    latest = await client.get_messages(bot, limit=1)
    before_id = latest[0].id if latest else 0
    await client.send_message(bot, "/start")
    menu = await wait_for_screen(
        client, bot, None, before_id,
        lambda msg: bool(msg.buttons) and rows(msg) == EXPECTED_MENU,
        "ROOM_NEW_START_MENU_NOT_FOUND",
    )
    steps = ["start_menu"]
    entered = False
    try:
        await menu.click(text="募集+Room")
        entered = True
        method = await wait_for_screen(
            client, bot, menu.id, before_id,
            lambda msg: any(button.text == "Room作成" for row in (msg.buttons or [])
                            for button in row),
            "ROOM_METHOD_PICKER_NOT_FOUND",
        )
        steps.append("room_method")
        await method.click(text="Room作成")
        guide = await wait_for_screen(
            client, bot, method.id, before_id,
            lambda msg: "1行目" in (msg.raw_text or "") and
                        "募集+Room" in (msg.raw_text or ""),
            "ROOM_INPUT_GUIDE_NOT_FOUND",
        )
        linked = ("2行目以降" in (guide.raw_text or "") and
                  "3行目" not in (guide.raw_text or "") and
                  "ニックネーム" not in (guide.raw_text or ""))
        payload = TEST_TEXT_LINKED if linked else TEST_TEXT_MANUAL
        input_message = await client.send_message(bot, payload)
        preview = await wait_for_screen(
            client, bot, guide.id, before_id,
            lambda msg: TEST_TITLE in (msg.raw_text or "") and bool(msg.buttons),
            "ROOM_INPUT_PREVIEW_NOT_UPDATED",
        )
        steps.append("room_input_preview")
        if await client.get_messages(bot, ids=input_message.id) is not None:
            raise RuntimeError("ROOM_INPUT_MESSAGE_NOT_DELETED")
        steps.append("room_input_deleted")
    finally:
        if entered:
            cancel = await wait_for_screen(
                client, bot, menu.id, before_id,
                lambda msg: any(button.text == "キャンセル" for row in (msg.buttons or [])
                                for button in row) and
                            ("募集+Room" in (msg.raw_text or "") or
                             TEST_TITLE in (msg.raw_text or "")),
                "ROOM_CANCEL_BUTTON_NOT_FOUND",
            )
            await cancel.click(text="キャンセル")
            await wait_for_screen(
                client, bot, cancel.id, before_id,
                lambda msg: bool(msg.buttons) and rows(msg) == EXPECTED_MENU,
                "ROOM_CANCEL_MENU_NOT_RESTORED",
            )
            steps.append("cancel_menu_restored")
    return {"status": "PASS", "action": "room_private_smoke", "steps": steps}


def main() -> int:
    # The command line never opens a Telethon session. The resident owns it.
    from userbot_test_client import invoke
    result = asyncio.run(invoke("room_private_smoke"))
    if result.get("status") != "PASS":
        print("ROOM_PRIVATE_SMOKE=FAIL")
        return 1
    print("ROOM_PRIVATE_SMOKE=PASS")
    print("ROOM_PRIVATE_SMOKE_STEPS=" + ",".join(result.get("steps", [])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
