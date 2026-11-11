#!/usr/bin/env python3
"""Persistent, interactive Telegram *test account* session bootstrap.

Uses an on-disk Telethon session under deploy/secrets. The phone and OTP are
entered locally only for initial authorization; never passed through host logs.
No messages are sent, no contacts exported and no production Bot is touched.
"""
from __future__ import annotations

import asyncio
import getpass
import os
import pathlib
import stat


ROOT = pathlib.Path(__file__).resolve().parents[1]
SECRETS = ROOT / "deploy" / "secrets"
ENV = SECRETS / "userbot.env"
SESSION_BASE = SECRETS / "userbot_verify"


def load_credentials() -> tuple[int, str]:
    if not ENV.is_file() or ENV.is_symlink():
        raise RuntimeError("USERBOT_SECRET_FILE_MISSING_OR_UNSAFE")
    if ENV.stat().st_mode & 0o077:
        raise RuntimeError("USERBOT_SECRET_PERMISSION_TOO_OPEN")
    pairs = {}
    for raw in ENV.read_text(encoding="utf-8").splitlines():
        if "=" in raw:
            key, val = raw.split("=", 1)
            pairs[key] = val
    api_id = pairs.get("TELEGRAM_API_ID", "")
    api_hash = pairs.get("TELEGRAM_API_HASH", "")
    if not api_id.isdecimal() or not api_hash:
        raise RuntimeError("USERBOT_API_CREDENTIALS_INVALID")
    return int(api_id), api_hash


async def main() -> None:
    os.umask(0o077)
    SECRETS.mkdir(mode=0o700, parents=True, exist_ok=True)
    if SECRETS.is_symlink() or SECRETS.stat().st_mode & 0o077:
        raise RuntimeError("USERBOT_SECRET_DIRECTORY_PERMISSION_TOO_OPEN")
    session = SESSION_BASE.with_suffix(".session")
    if session.is_symlink():
        raise RuntimeError("USERBOT_SESSION_SYMLINK_REFUSED")
    try:
        from telethon import TelegramClient
        from telethon.errors import SessionPasswordNeededError
    except ImportError as exc:
        raise RuntimeError("TELETHON_NOT_INSTALLED") from exc
    api_id, api_hash = load_credentials()
    client = TelegramClient(str(SESSION_BASE), api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            phone = getpass.getpass("初回のみ電話番号（+81...）: ").strip()
            if not phone.startswith("+") or not phone[1:].isdigit():
                raise RuntimeError("PHONE_NUMBER_FORMAT_INVALID")
            sent = await client.send_code_request(phone)
            code = getpass.getpass("Telegram認証コード（非表示）: ").strip()
            try:
                await client.sign_in(phone=phone, code=code, phone_code_hash=sent.phone_code_hash)
            except SessionPasswordNeededError:
                password = getpass.getpass("2段階認証パスワード（非表示）: ")
                await client.sign_in(password=password)
        if not await client.is_user_authorized():
            raise RuntimeError("USERBOT_AUTHORIZATION_NOT_ESTABLISHED")
        if session.exists():
            session.chmod(stat.S_IRUSR | stat.S_IWUSR)
        print("USERBOT_AUTHORIZED=YES")
        print("PERSISTENT_SESSION=YES")
        print("SESSION_PERMISSION=600")
        print("PHONE_OR_LOGIN_CODE_OUTPUT=NO")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
