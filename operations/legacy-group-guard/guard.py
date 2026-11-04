#!/usr/bin/env python3
"""Legacy group lockdown guard. Dedicated Bot token, no user session.

Only the explicitly configured OLD_CHAT_ID is managed. Requires Telegram bot
admin rights: delete messages, restrict members, change chat info.
"""
import json
import logging
import os
from pathlib import Path
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

LOG = logging.getLogger("legacy_guard")
ALLOWED_OLD_CHAT_ID = -1002374817170
PERMISSION_KEYS = (
    "can_send_messages", "can_send_audios", "can_send_documents",
    "can_send_photos", "can_send_videos", "can_send_video_notes",
    "can_send_voice_notes", "can_send_polls", "can_send_other_messages",
    "can_add_web_page_previews", "can_change_info",
    "can_invite_users", "can_pin_messages", "can_manage_topics",
)
LOCKED = {key: False for key in PERMISSION_KEYS}


class TelegramError(RuntimeError):
    pass


def required(key):
    value = os.environ.get(key, "").strip()
    if not value:
        raise ValueError("Missing required setting: " + key)
    return value


def api(token, method, values=None, photo=None, timeout=25):
    url = "https://api.telegram.org/bot" + token + "/" + method
    values = values or {}
    if photo is None:
        payload = urllib.parse.urlencode({
            k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v
            for k, v in values.items()
        }).encode()
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
    else:
        boundary = "GACE" + os.urandom(12).hex()
        chunks = []
        for key, value in values.items():
            chunks.append(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" +
                           key + "\"\r\n\r\n" + str(value) + "\r\n").encode())
        chunks.append(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"canonical.jpg\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode())
        chunks.append(photo)
        chunks.append(("\r\n--" + boundary + "--\r\n").encode())
        payload = b"".join(chunks)
        headers = {"Content-Type": "multipart/form-data; boundary=" + boundary}
    req = urllib.request.Request(url, payload, headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise TelegramError(method + " HTTP_" + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise TelegramError(method + " network failure: " + type(exc).__name__) from None
    if not result.get("ok"):
        raise TelegramError(method + " API rejected; code=" + str(result.get("error_code")))
    return result["result"]


def load_state(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def save_state(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def restore(token, chat_id, title, about, state, state_path):
    chat = api(token, "getChat", {"chat_id": chat_id})
    if chat.get("type") != "supergroup" or int(chat["id"]) != chat_id:
        raise TelegramError("Unexpected chat type/id: refused")
    if chat.get("title", "") != title:
        api(token, "setChatTitle", {"chat_id": chat_id, "title": title})
        LOG.warning("Restored group title")
    if chat.get("description", "") != about:
        api(token, "setChatDescription", {"chat_id": chat_id, "description": about})
        LOG.warning("Restored group description")
    permissions = chat.get("permissions") or {}
    if not state.get("permissions_locked") or any(bool(permissions.get(k)) for k in PERMISSION_KEYS):
        api(token, "setChatPermissions", {
            "chat_id": chat_id, "permissions": LOCKED,
            "use_independent_chat_permissions": "true"
        })
        state["permissions_locked"] = True
        save_state(state_path, state)
        LOG.warning("Restored members' read-only permissions")
    if chat.get("photo"):
        api(token, "deleteChatPhoto", {"chat_id": chat_id})
        LOG.warning("Restored no-photo group state")


def kick_new_member(token, chat_id, user, self_bot_id):
    """Remove only users/bots joining after guard starts, without a permanent ban.

    Never remove the guard itself or an existing administrator. Telegram will reject
    restricting administrators; record that limitation without weakening other rules.
    """
    if chat_id != ALLOWED_OLD_CHAT_ID:
        raise TelegramError("Wrong chat: refusing kick")
    if not isinstance(user, dict) or not isinstance(user.get("id"), int):
        return "INVALID"
    uid = int(user["id"])
    if uid == self_bot_id:
        return "GUARD_SELF"
    info = api(token, "getChatMember", {"chat_id": chat_id, "user_id": uid})
    status = info.get("status")
    if status in ("administrator", "creator"):
        LOG.error("New member has administrator rights; cannot kick id=%s", uid)
        return "ADMIN_PROTECTED_BY_TELEGRAM"
    if status in ("left", "kicked"):
        return "ALREADY_LEFT"
    api(token, "banChatMember", {"chat_id": chat_id, "user_id": uid, "revoke_messages": "true"})
    api(token, "unbanChatMember", {"chat_id": chat_id, "user_id": uid, "only_if_banned": "true"})
    LOG.warning("Kicked new member id=%s is_bot=%s", uid, bool(user.get("is_bot")))
    return "KICKED"


def handle_update(token, chat_id, bot_id, update):
    """Delete every visible post and remove every observed joining user/bot."""
    actions = []
    if not isinstance(update, dict):
        return actions
    change = update.get("chat_member") or {}
    if (change.get("chat") or {}).get("id") == chat_id:
        old = (change.get("old_chat_member") or {}).get("status")
        new = (change.get("new_chat_member") or {}).get("status")
        user = (change.get("new_chat_member") or {}).get("user")
        if old in ("left", "kicked") and new in ("member", "restricted", "administrator"):
            actions.append(kick_new_member(token, chat_id, user, bot_id))
    for field in ("message", "edited_message", "channel_post", "edited_channel_post"):
        msg = update.get(field) or {}
        if (msg.get("chat") or {}).get("id") != chat_id:
            continue
        # Membership service messages also contain new_chat_members; use both
        # this fallback and chat_member updates with idempotent status checking.
        for user in msg.get("new_chat_members") or []:
            actions.append(kick_new_member(token, chat_id, user, bot_id))
        if msg.get("message_id"):
            api(token, "deleteMessage", {
                "chat_id": chat_id, "message_id": int(msg["message_id"])
            })
            actions.append("MESSAGE_DELETED")
    return actions


def run():
    token = required("GUARD_BOT_TOKEN")
    if not token.split(":")[0].isdigit():
        raise ValueError("Invalid Bot token format")
    chat_id = int(required("OLD_CHAT_ID"))
    if chat_id != ALLOWED_OLD_CHAT_ID:
        raise ValueError("Unapproved group ID: refused")
    title = "閉鎖したグループ"
    about = "このグループは閉鎖され一切の機能を停止しています"
    if len(title) > 128 or len(about) > 255:
        raise ValueError("Canonical group text is too long")
    state_path = Path(os.environ.get("GUARD_STATE_FILE", "./.guard-state.json"))
    state = load_state(state_path)
    me = api(token, "getMe")
    bot_id = int(me["id"])
    rights = api(token, "getChatMember", {"chat_id": chat_id, "user_id": bot_id})
    if rights.get("status") != "administrator" or not all(rights.get(k) for k in
        ("can_delete_messages", "can_restrict_members", "can_change_info")):
        raise TelegramError("Guard bot lacks required group admin rights")
    LOG.info("Guard ready: chat=%s bot_id=%s", chat_id, bot_id)
    offset = int(state.get("offset", 0))
    next_check = 0.0
    while True:
        try:
            if time.monotonic() >= next_check:
                restore(token, chat_id, title, about, state, state_path)
                next_check = time.monotonic() + 30
            updates = api(token, "getUpdates", {
                "offset": offset, "timeout": 10,
                "allowed_updates": ["message", "edited_message", "channel_post", "edited_channel_post", "chat_member"]
            }, timeout=18)
            for update in updates:
                update_id = int(update["update_id"])
                if update_id < offset:
                    continue
                try:
                    actions = handle_update(token, chat_id, bot_id, update)
                    if actions:
                        LOG.info("Guard actions update=%s outcomes=%s", update_id, actions)
                        next_check = 0.0
                except TelegramError as exc:
                    # An API or permission error must not silently advance the
                    # cursor and permanently discard a join or message to delete.
                    LOG.error("Update failed id=%s: %s", update_id, exc)
                    raise
                offset = update_id + 1
                state["offset"] = offset
                save_state(state_path, state)
        except (TelegramError, OSError, ValueError) as exc:
            LOG.error("Guard cycle failure: %s", exc)
            time.sleep(5 + random.random() * 2)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        run()
    except (ValueError, TelegramError) as error:
        LOG.error("Guard preflight refused: %s", error)
        sys.exit(2)
