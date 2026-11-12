#!/usr/bin/env python3
"""Bounded, single-use public Room publishing E2E through the existing resident Userbot.

Use only from allowlisted IPC. No session client, reauth, group join, arbitrary
message send, or Bot API bypass. Publishing is deliberately NOT retried on
uncertain results. A test is marked explicitly, then closed via owner DM.
"""
from __future__ import annotations

import asyncio
from typing import Any
from userbot_room_smoke import BOT, EXPECTED_MENU, rows, wait_for_screen

TEST_TITLE = "【検証】ROOM公開同期テスト"
TEST_MANUAL = TEST_TITLE + "\n検証用ユーザー\n170 70 30\nBot投稿と終了同期の確認用です。参加募集ではありません。"
TEST_LINKED = TEST_TITLE + "\nBot投稿と終了同期の確認用です。参加募集ではありません。"


def labels(message: Any) -> list[str]:
    return [button.text for row in (message.buttons or []) for button in row]


def find_callback(message: Any, prefix: str, suffix: str = "") -> Any:
    candidates = [b for row in (message.buttons or []) for b in row
                  if (getattr(b, "data", None) or b"").decode("utf-8").startswith(prefix)
                  and (not suffix or (getattr(b, "data", None) or b"").decode("utf-8").endswith(suffix))]
    if len(candidates) != 1:
        raise RuntimeError("ROOM_PUBLIC_TEST_BUTTON_AMBIGUOUS")
    return candidates[0]


async def run(client: Any) -> dict[str, Any]:
    bot = await client.get_entity(BOT)
    if not bot.bot:
        raise RuntimeError("ROOM_PUBLIC_TEST_BOT_NOT_VERIFIED")
    prev = await client.get_messages(bot, limit=1)
    baseline = prev[0].id if prev else 0
    await client.send_message(bot, "/start")
    menu = await wait_for_screen(
        client, bot, None, baseline,
        lambda m: bool(m.buttons) and rows(m) == EXPECTED_MENU,
        "ROOM_PUBLIC_TEST_START_MENU_MISSING")
    await menu.click(text="募集+Room")
    method = await wait_for_screen(
        client, bot, menu.id, baseline,
        lambda m: "Room作成" in labels(m),
        "ROOM_PUBLIC_TEST_METHOD_MISSING")
    await method.click(text="Room作成")
    guide = await wait_for_screen(
        client, bot, method.id, baseline,
        lambda m: "1行目" in (m.raw_text or "") and "募集+Room" in (m.raw_text or ""),
        "ROOM_PUBLIC_TEST_INPUT_MISSING")
    linked = "2行目以降" in (guide.raw_text or "") and "3行目" not in (guide.raw_text or "")
    sent = await client.send_message(bot, TEST_LINKED if linked else TEST_MANUAL)
    preview = await wait_for_screen(
        client, bot, guide.id, baseline,
        lambda m: TEST_TITLE in (m.raw_text or "") and bool(m.buttons),
        "ROOM_PUBLIC_TEST_PREVIEW_MISSING")
    if await client.get_messages(bot, ids=sent.id) is not None:
        raise RuntimeError("ROOM_PUBLIC_TEST_INPUT_NOT_DELETED")

    if not linked:
        position = next((b for row in preview.buttons for b in row
                         if "ポジション" in b.text), None)
        if position is None:
            raise RuntimeError("ROOM_PUBLIC_TEST_POSITION_MISSING")
        await position.click()
        picker = await wait_for_screen(
            client, bot, preview.id, baseline,
            lambda m: "ポジションを選んで" in (m.raw_text or ""),
            "ROOM_PUBLIC_TEST_POSITION_PICKER_MISSING")
        await find_callback(picker, "room:positionchoice:").click()
        preview = await wait_for_screen(
            client, bot, picker.id, baseline,
            lambda m: TEST_TITLE in (m.raw_text or "") and "▶ 即開始" in labels(m),
            "ROOM_PUBLIC_TEST_POSITION_NOT_SAVED")

    # This callback is the one and only public publishing attempt.
    # A missing destination opens the existing verified destination picker.
    await preview.click(text="▶ 即開始")
    outcome = await wait_for_screen(
        client, bot, preview.id, baseline,
        lambda m: ("投稿先グループを選択" in (m.raw_text or "")
                   or "投稿するトピックを選択" in (m.raw_text or "")
                   or "投稿ID：" in (m.raw_text or "")
                   or "未確認の送信記録" in (m.raw_text or "")
                   or "投稿状態を確認" in (m.raw_text or "")),
        "ROOM_PUBLIC_TEST_PUBLISH_OUTCOME_UNVERIFIED")
    # If the source origin is unavailable, choose a *registered* video group,
    # then a verified VideoChat topic from the actual bot-presented options.
    if "投稿先グループを選択" in (outcome.raw_text or ""):
        await find_callback(outcome, "room:destgroup:", ":video_chat").click()
        outcome = await wait_for_screen(
            client, bot, outcome.id, baseline,
            lambda m: "投稿するトピックを選択" in (m.raw_text or ""),
            "ROOM_PUBLIC_TEST_VIDEO_TOPICS_MISSING")
    if "投稿するトピックを選択" in (outcome.raw_text or ""):
        topics = [b for row in outcome.buttons for b in row
                  if (getattr(b, "data", None) or b"").decode("utf-8").startswith("room:destchoose:")
                  and ("ビデオチャット" in b.text or "オンライン" in b.text or "Room" in b.text)]
        if len(topics) != 1:
            raise RuntimeError("ROOM_PUBLIC_TEST_TARGET_NOT_UNAMBIGUOUS")
        await topics[0].click()
        preview = await wait_for_screen(
            client, bot, outcome.id, baseline,
            lambda m: TEST_TITLE in (m.raw_text or "") and "▶ 即開始" in labels(m),
            "ROOM_PUBLIC_TEST_VERIFIED_ORIGIN_NOT_SAVED")
        await preview.click(text="▶ 即開始")
        outcome = await wait_for_screen(
            client, bot, preview.id, baseline,
            lambda m: "投稿ID：" in (m.raw_text or "") or "投稿状態を確認" in (m.raw_text or ""),
            "ROOM_PUBLIC_TEST_PUBLISH_AFTER_TOPIC_UNVERIFIED")

    if "投稿ID：" not in (outcome.raw_text or ""):
        raise RuntimeError("ROOM_PUBLIC_TEST_PUBLISH_NOT_CONFIRMED")
    if "🔴 LIVE中" not in (outcome.raw_text or ""):
        raise RuntimeError("ROOM_PUBLIC_TEST_NOT_LIVE")
    if "✅ 終了する" not in labels(outcome):
        raise RuntimeError("ROOM_PUBLIC_TEST_FINISH_BUTTON_MISSING")
    # Keep the same original published DM editor; never re-post.
    await outcome.click(text="✅ 終了する")
    closed = await wait_for_screen(
        client, bot, outcome.id, baseline,
        lambda m: TEST_TITLE in (m.raw_text or "") and "✅ 終了" in (m.raw_text or ""),
        "ROOM_PUBLIC_TEST_FINISH_NOT_CONFIRMED")
    return {"action": "room_public_post_smoke", "status": "PASS",
            "published": True, "finished_dm": True,
            "has_public_destination_buttons": any(
                "投稿先" in label for label in labels(closed))}
