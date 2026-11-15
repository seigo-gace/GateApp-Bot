#!/usr/bin/env python3
"""Non-public notice UI verification through the EXISTING resident Userbot.

Only uses the already-authorized resident client passed to run(). Never opens a
Telegram session, changes credentials, visits groups, or clicks Publish.
"""
from __future__ import annotations

import asyncio
import io
import struct
import zlib
from typing import Any

from userbot_room_smoke import BOT, wait_for_screen, rows

TEST_TITLE = "【検証】告知プレビュー（未投稿）"
TEST_TEXT = TEST_TITLE + "\n本文・画像・ボタン配置を検証します。公開しません。"
PREVIEW_ROWS = [
    ["日時設定", "期限設定", "参加方法"],
    ["画像/動画変更", "🔗ボタン", "下書き保存"],
    ["投稿する", "キャンセル"],
]


def png_image() -> io.BytesIO:
    """Original 64×64 PNG test fixture; no stored files or other users' media."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(
            ">I", zlib.crc32(kind + data) & 0xffffffff)
    raw = (b"\x00" + b"\x40\x9e\xd1" * 64) * 64
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(
        ">IIBBBBB", 64, 64, 8, 2, 0, 0, 0)) + chunk(
            b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    file = io.BytesIO(data)
    file.name = "notice_test.png"
    return file


def flat_labels(message: Any) -> list[str]:
    return [b.text for row in (message.buttons or []) for b in row]


async def run(client: Any) -> dict[str, Any]:
    phase = "INIT"
    bot = await client.get_entity(BOT)
    if not bot.bot:
        return {"action": "notice_private_smoke", "status": "FAIL",
                "error": "NOTICE_TARGET_NOT_BOT"}
    latest = await client.get_messages(bot, limit=1)
    before = latest[0].id if latest else 0
    entered = False
    screen = None
    steps = []
    try:
        phase = "START"
        await client.send_message(bot, "/start")
        menu = await wait_for_screen(client, bot, None, before,
            lambda m: "告知/予告" in flat_labels(m),
            "NOTICE_START_MENU_MISSING")
        steps.append("start_menu")

        phase = "ENTER"
        await menu.click(text="告知/予告")
        entered = True
        guide = await wait_for_screen(client, bot, menu.id, before,
            lambda m: ("1行目" in (m.raw_text or "")
                       and "2行目" in (m.raw_text or "")
                       and "画像" in (m.raw_text or ""))
                       or TEST_TITLE in (m.raw_text or ""),
            "NOTICE_INPUT_GUIDE_MISSING")
        if TEST_TITLE in (guide.raw_text or ""):
            raise RuntimeError("NOTICE_EXISTING_DRAFT_REFUSED")
        screen = guide
        steps.append("combined_input_guide")

        phase = "INPUT"
        sent = await client.send_message(bot, TEST_TEXT)
        preview = await wait_for_screen(client, bot, guide.id, before,
            lambda m: TEST_TITLE in (m.raw_text or "") and
                      "投稿する" in flat_labels(m),
            "NOTICE_PREVIEW_MISSING")
        screen = preview
        if rows(preview) != PREVIEW_ROWS:
            raise RuntimeError("NOTICE_PREVIEW_ROWS_MISMATCH")
        body = preview.raw_text or ""
        if ("［編集］タイトル：" not in body or "［編集］説明：" not in body or
            "開催日時：未設定" not in body or "受付期限：未設定" not in body or
            "参加方法：未設定" not in body):
            raise RuntimeError("NOTICE_PREVIEW_TEXT_MISMATCH")
        steps.append("preview_layout_332")
        if await client.get_messages(bot, ids=sent.id) is not None:
            raise RuntimeError("NOTICE_INPUT_NOT_DELETED")
        steps.append("input_deleted")

        phase = "PARTICIPATION"
        await preview.click(text="参加方法")
        choice = await wait_for_screen(client, bot, preview.id, before,
            lambda m: "自由参加" in flat_labels(m) and
                      "承認制" in flat_labels(m) and
                      "設定を解除" in flat_labels(m),
            "NOTICE_PARTICIPATION_CHOICES_MISSING")
        screen = choice
        await choice.click(text="自由参加")
        public = await wait_for_screen(client, bot, choice.id, before,
            lambda m: TEST_TITLE in (m.raw_text or "") and
                      "参加方法：自由参加" in (m.raw_text or "") and
                      rows(m) == PREVIEW_ROWS,
            "NOTICE_FREE_JOIN_PREVIEW_MISSING")
        screen = public
        steps.append("free_join_option")
        # Return to unset status before media preview.
        await public.click(text="参加方法")
        choice = await wait_for_screen(client, bot, public.id, before,
            lambda m: "設定を解除" in flat_labels(m),
            "NOTICE_PARTICIPATION_RESET_MISSING")
        screen = choice
        await choice.click(text="設定を解除")
        preview = await wait_for_screen(client, bot, choice.id, before,
            lambda m: TEST_TITLE in (m.raw_text or "") and
                      "参加方法：未設定" in (m.raw_text or "") and
                      rows(m) == PREVIEW_ROWS,
            "NOTICE_UNSET_JOIN_PREVIEW_MISSING")
        screen = preview
        steps.append("optional_join_reset")

        phase = "MEDIA"
        existing = await client.get_messages(bot, limit=30)
        old_bot_photo_ids = {m.id for m in existing if not m.out and getattr(m, "photo", None)}
        photo = await client.send_file(bot, png_image(), force_document=False)
        # The Bot must display the actual photo back in its private DM.
        observed = False
        for _ in range(20):
            recent = await client.get_messages(bot, limit=40)
            observed = any((not m.out and getattr(m, "photo", None)
                            and m.id not in old_bot_photo_ids)
                           for m in recent)
            if observed:
                break
            await asyncio.sleep(0.4)
        if not observed:
            raise RuntimeError("NOTICE_ACTUAL_MEDIA_PREVIEW_MISSING")
        preview = await wait_for_screen(client, bot, preview.id, before,
            lambda m: TEST_TITLE in (m.raw_text or "") and
                      rows(m) == PREVIEW_ROWS,
            "NOTICE_MEDIA_PREVIEW_TEXT_MISSING")
        screen = preview
        if await client.get_messages(bot, ids=photo.id) is not None:
            raise RuntimeError("NOTICE_MEDIA_INPUT_NOT_DELETED")
        steps.append("actual_photo_preview")
        steps.append("media_input_deleted")
        return {"action": "notice_private_smoke", "status": "PASS",
                "steps": steps, "published": False}
    except Exception as exc:
        error = str(exc)
        if not error.startswith("NOTICE_"):
            error = "NOTICE_TEST_FAILED_" + phase
        return {"action": "notice_private_smoke", "status": "FAIL",
                "error": error, "steps": steps}
    finally:
        # Test never publishes. Best-effort cleanup of this test draft only.
        if entered and screen is not None:
            try:
                active = await wait_for_screen(client, bot, screen.id, before,
                    lambda m: TEST_TITLE in (m.raw_text or "")
                    and "キャンセル" in flat_labels(m),
                    "NOTICE_CLEANUP_BUTTON_MISSING")
                await active.click(text="キャンセル")
                await wait_for_screen(client, bot, active.id, before,
                    lambda m: "告知/予告" in flat_labels(m),
                    "NOTICE_CLEANUP_MENU_MISSING")
            except Exception:
                # Never alter other drafts or click public posting to recover.
                pass
