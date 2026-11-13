#!/usr/bin/env python3
"""Read-only topic and pinned posting-button audit through the resident Userbot.

Never creates another Telegram session, joins chats, sends messages, or modifies pins.
Caller must use the owner-only resident IPC. Titles and IDs are current Telegram
observations, not inferred from t.me/c URL suffixes.
"""
from __future__ import annotations

import asyncio

AREA_CHAT = -1003847210571
CATEGORY_CHAT = -1003770334893
AUDIT_CHATS = frozenset((AREA_CHAT, CATEGORY_CHAT))
PAGE_SIZE = 8
MAX_TOPICS = 200


def posting_entry(message, bot_id: int) -> bool:
    if getattr(message, "sender_id", None) != bot_id:
        return False
    for row in getattr(message, "buttons", None) or ():
        for button in row:
            label = str(getattr(button, "text", "") or "")
            url = str(getattr(button, "url", "") or "")
            normalized = url.lower()
            if ("投稿" in label and
                ("t.me/gaybbs_bot?start=" in normalized or
                 "telegram.me/gaybbs_bot?start=" in normalized)):
                return True
    return False


async def existing_chat(client, chat_id: int):
    try:
        return await client.get_input_entity(chat_id)
    except ValueError:
        dialogs = await client.get_dialogs(limit=500)
        for dialog in dialogs:
            if dialog.id == chat_id:
                return await client.get_input_entity(dialog.entity)
        raise RuntimeError("TOPIC_AUDIT_GROUP_NOT_JOINED") from None


async def list_topics(client, entity):
    from telethon.tl import functions
    offset_date = offset_id = offset_topic = 0
    result = []
    seen = set()
    for _ in range(20):
        batch = await client(functions.messages.GetForumTopicsRequest(
            peer=entity, offset_date=offset_date, offset_id=offset_id,
            offset_topic=offset_topic, limit=100))
        topics = [t for t in batch.topics if
                  isinstance(getattr(t, "id", None), int) and
                  isinstance(getattr(t, "title", None), str)]
        if not topics:
            break
        fresh = [t for t in topics if t.id not in seen]
        if not fresh:
            raise RuntimeError("TOPIC_AUDIT_PAGINATION_STALLED")
        for t in fresh:
            seen.add(t.id)
            result.append(t)
        if len(result) > MAX_TOPICS:
            raise RuntimeError("TOPIC_AUDIT_TOPIC_LIMIT")
        if len(result) >= getattr(batch, "count", 0):
            break
        last = topics[-1]
        offset_topic = last.id
        offset_id = int(getattr(last, "top_message", 0))
        matched = next((m for m in batch.messages if m.id == offset_id), None)
        offset_date = int(matched.date.timestamp()) if matched else 0
    else:
        raise RuntimeError("TOPIC_AUDIT_PAGINATION_LIMIT")
    return result


async def pinned_post_entry(client, entity, topic_id: int, bot_id: int):
    from telethon.tl import functions, types
    response = await client(functions.messages.SearchRequest(
        peer=entity, q="", filter=types.InputMessagesFilterPinned(),
        min_date=None, max_date=None, offset_id=0, add_offset=0,
        limit=100, max_id=0, min_id=0, hash=0, top_msg_id=topic_id))
    found = [m.id for m in response.messages if posting_entry(m, bot_id)]
    total = int(getattr(response, "count", len(response.messages)))
    if found:
        return {"state": "PRESENT", "message_ids": found[:5]}
    if total > len(response.messages):
        return {"state": "INCONCLUSIVE_PIN_PAGE_LIMIT", "message_ids": []}
    return {"state": "ABSENT", "message_ids": []}


async def audit(client, chat_id: int, page: int):
    if type(chat_id) is not int or chat_id not in AUDIT_CHATS:
        raise ValueError("TOPIC_AUDIT_CHAT_NOT_ALLOWED")
    if type(page) is not int or not 0 <= page <= 24:
        raise ValueError("TOPIC_AUDIT_PAGE_INVALID")
    entity = await existing_chat(client, chat_id)
    topics = await list_topics(client, entity)
    bot = await client.get_entity("GayBBS_bot")
    if not getattr(bot, "bot", False):
        raise RuntimeError("TOPIC_AUDIT_TARGET_BOT_INVALID")
    selected = topics[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
    rows = []
    for topic in selected:
        status = await pinned_post_entry(client, entity, topic.id, bot.id)
        rows.append({
            "topic_id": topic.id,
            "title": topic.title[:120],
            "post_button": status["state"],
            "pin_message_ids": status["message_ids"],
        })
        await asyncio.sleep(0.12)
    return {
        "status": "PASS", "chat": "area" if chat_id == AREA_CHAT else "category",
        "page": page, "total_topics": len(topics),
        "has_more": (page + 1) * PAGE_SIZE < len(topics),
        "rows": rows,
    }
