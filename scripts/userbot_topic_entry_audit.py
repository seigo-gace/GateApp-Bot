#!/usr/bin/env python3
"""Read-only topic and pinned posting-button audit through the resident Userbot.

Never creates another Telegram session, joins chats, sends messages, or modifies pins.
Caller must use the owner-only resident IPC. Titles and IDs are current Telegram
observations, not inferred from t.me/c URL suffixes.
"""
from __future__ import annotations

import asyncio
from urllib.parse import urlsplit, parse_qs

AREA_CHAT = -1003847210571
CATEGORY_CHAT = -1003770334893
VIDEO_CHAT = -1002373696859
AUDIT_CHATS = frozenset((AREA_CHAT, CATEGORY_CHAT, VIDEO_CHAT))
PAGE_SIZE = 8
MAX_TOPICS = 200


def posting_entry(message, bot_id: int) -> bool:
    return button_type(message, bot_id) is not None


def button_type(message, bot_id: int):
    """Classify only existing @GayBBS_bot keyboards; never infer from text alone."""
    if getattr(message, "sender_id", None) != bot_id:
        return None
    labels = []
    recognized = False
    for row in getattr(message, "buttons", None) or ():
        for button in row:
            label = str(getattr(button, "text", "") or "")
            url = str(getattr(button, "url", "") or "")
            data = getattr(button, "data", None)
            parsed = urlsplit(url)
            start = parse_qs(parsed.query).get("start", [])
            recognized_url = (parsed.scheme == "https" and
                (parsed.hostname or "").lower() in {"t.me", "telegram.me"} and
                parsed.path.lower().strip("/") == "gaybbs_bot" and
                len(start) == 1 and bool(start[0]))
            recognized_cb = isinstance(data, bytes) and (data.startswith(b"gdm:p_") or data.startswith(b"gdm:m_"))
            recognized_creator = (("クリエーター" in label or "クリエイター" in label) and
                parsed.scheme == "https" and
                (parsed.hostname or "").lower() in {"t.me", "telegram.me"} and
                parsed.path.lower().strip("/") == "createvdobot")
            eligible_label = any(word in label for word in ("投稿", "プロフ", "プロフィール", "クリエーター", "クリエイター"))
            if eligible_label and (recognized_url or recognized_cb or recognized_creator):
                recognized = True
            labels.append(label)
    if not recognized:
        return None
    if len(labels) == 1 and ("プロフ" in labels[0] or "プロフィール" in labels[0]):
        return "profile"
    if len(labels) == 1 and ("クリエーター" in labels[0] or "クリエイター" in labels[0]):
        return "creator"
    return "normal"


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
            peer=entity, q="", offset_date=offset_date, offset_id=offset_id,
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
        offset_date = matched.date if matched else getattr(last, "date", None) or 0
    else:
        raise RuntimeError("TOPIC_AUDIT_PAGINATION_LIMIT")
    return result


async def pinned_post_entry(client, entity, topic_id: int, bot_id: int):
    from telethon.tl import functions, types
    response = await client(functions.messages.SearchRequest(
        peer=entity, q="", filter=types.InputMessagesFilterPinned(),
        min_date=None, max_date=None, offset_id=0, add_offset=0,
        limit=100, max_id=0, min_id=0, hash=0, top_msg_id=topic_id))
    found = [(m.id, button_type(m, bot_id)) for m in response.messages if posting_entry(m, bot_id)]
    total = int(getattr(response, "count", len(response.messages)))
    if found:
        return {"state": "PRESENT", "message_ids": [x[0] for x in found[:5]], "button_types": [x[1] for x in found[:5]]}
    if total > len(response.messages):
        return {"state": "INCONCLUSIVE_PIN_PAGE_LIMIT", "message_ids": [], "button_types": []}
    return {"state": "ABSENT_FROM_PINS", "message_ids": [], "button_types": []}


async def recent_topic_buttons(client, entity, topic_id: int, bot_id: int):
    """Inspect topic starter and actual message history; never create any post."""
    inspected = 0
    found = []
    seen = set()
    try:
        starter = await client.get_messages(entity, ids=topic_id)
        if starter is not None:
            inspected += 1
            seen.add(starter.id)
            typ = button_type(starter, bot_id)
            if typ is not None:
                found.append((starter.id, typ))
        async for message in client.iter_messages(entity, reply_to=topic_id, limit=150):
            if message.id in seen:
                continue
            seen.add(message.id)
            inspected += 1
            typ = button_type(message, bot_id)
            if typ is not None:
                found.append((message.id, typ))
                if len(found) == 5:
                    break
    except Exception:
        return {"state": "INCONCLUSIVE_HISTORY_QUERY_FAILED",
                "message_ids": [], "button_types": [], "inspected": inspected}
    return {"state": "PRESENT" if found else
            "INCONCLUSIVE_HISTORY_LIMIT" if inspected >= 150 else "ABSENT",
            "message_ids": [x[0] for x in found],
            "button_types": [x[1] for x in found],
            "inspected": inspected}


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
        history = await recent_topic_buttons(client, entity, topic.id, bot.id)
        rows.append({
            "topic_id": topic.id,
            "title": topic.title[:120],
            "post_button": "PRESENT" if status["state"] == "PRESENT" or
                           history["state"] == "PRESENT" else history["state"],
            "pin_state": status["state"],
            "pin_message_ids": status["message_ids"],
            "history_message_ids": history["message_ids"],
            "history_inspected": history["inspected"],
            "button_types": list(dict.fromkeys(status["button_types"] + history["button_types"])),
        })
        await asyncio.sleep(0.12)
    return {
        "status": "PASS", "chat": ("area" if chat_id == AREA_CHAT else
                 "video" if chat_id == VIDEO_CHAT else "category"),
        "page": page, "total_topics": len(topics),
        "has_more": (page + 1) * PAGE_SIZE < len(topics),
        "rows": rows,
    }
