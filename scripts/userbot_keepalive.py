#!/usr/bin/env python3
"""Keep the existing authorized Telegram test session connected; never sign out.

No phone number, login code, API secret or session contents go to logs.
This does not prevent server-side auth-key revocation or a reassigned number
being used by a third party. No SMS/login is attempted by this worker.
"""
from __future__ import annotations

import asyncio
import fcntl
import os
import pathlib
import random
import signal

from userbot_session import SECRETS, SESSION_BASE, load_credentials

LOCK = SECRETS / "userbot_verify.lock"
SESSION = SESSION_BASE.with_suffix(".session")


async def run() -> None:
    os.umask(0o077)
    if not SESSION.is_file() or SESSION.is_symlink():
        raise RuntimeError("USERBOT_NOT_ENROLLED")
    if SESSION.stat().st_mode & 0o077:
        raise RuntimeError("USERBOT_SESSION_PERMISSIONS_INVALID")
    api_id, api_hash = load_credentials()
    try:
        from telethon import TelegramClient
        from telethon.errors import AuthKeyUnregisteredError
    except ImportError as exc:
        raise RuntimeError("TELETHON_NOT_INSTALLED") from exc

    with LOCK.open("a+b") as handle:
        os.chmod(LOCK, 0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("USERBOT_ALREADY_RUNNING") from exc

        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, stop.set)
            except NotImplementedError:
                pass

        attempt = 0
        while not stop.is_set():
            client = TelegramClient(
                str(SESSION_BASE), api_id, api_hash,
                auto_reconnect=True, connection_retries=5,
                retry_delay=3, request_retries=3,
            )
            try:
                await client.connect()
                if not await client.is_user_authorized():
                    raise RuntimeError("USERBOT_SESSION_REVOKED_REAUTH_REQUIRED")
                # TelegramClient auto-reconnects transport without sign_out/login.
                # No user messages or public activity are generated.
                print("USERBOT_SESSION_CONNECTED", flush=True)
                attempt = 0
                connection = asyncio.create_task(client.run_until_disconnected())
                stopping = asyncio.create_task(stop.wait())
                done, pending = await asyncio.wait(
                    {connection, stopping}, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    if task is connection:
                        task.result()
                if stop.is_set():
                    break
                print("USERBOT_TRANSPORT_DISCONNECTED_RETRYING", flush=True)
            except (AuthKeyUnregisteredError, RuntimeError) as exc:
                # Explicit auth failures fail closed, never request SMS or OTP.
                if isinstance(exc, AuthKeyUnregisteredError) or (
                    isinstance(exc, RuntimeError) and
                    str(exc) == "USERBOT_SESSION_REVOKED_REAUTH_REQUIRED"
                ):
                    raise RuntimeError("USERBOT_SESSION_REVOKED_REAUTH_REQUIRED") from None
                print("USERBOT_CONNECTION_RETRY", flush=True)
            except Exception:
                print("USERBOT_CONNECTION_RETRY", flush=True)
            finally:
                # Disconnect closes TCP only. It does NOT revoke the Telegram session.
                await client.disconnect()
            attempt += 1
            try:
                await asyncio.wait_for(stop.wait(), timeout=min(120, 2 ** min(attempt, 6)) + random.random())
            except asyncio.TimeoutError:
                pass
        print("USERBOT_WORKER_STOPPED_SESSION_SAVED", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except RuntimeError as exc:
        if str(exc) == "USERBOT_SESSION_REVOKED_REAUTH_REQUIRED":
            print("USERBOT_AUTHORIZATION_REVOKED_NO_AUTOMATIC_LOGIN", flush=True)
            raise SystemExit(42) from None
        raise
