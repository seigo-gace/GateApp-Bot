# G-JUMP old-group defensive guard (isolated)

This is a **standalone** Bot API application, not the active GateApp-Bot deployment. It never logs into the retired userbot/virtual-number account. It operates **only** in confirmed old group `-1002374817170` and hard-refuses any other ID. Its code does not touch the new three boards.

## Functions
- Delete **all received new and edited posts**, including those from ordinary users, administrators and bots, plus visible join service messages. The bot must receive the update first; it cannot prevent transient visibility.
- Reconcile ordinary member send permissions to all-false at startup and every 30 seconds, including after an administrator relaxes them.
- **Kick all newly joining users and bots** detected by `chat_member` or service updates: `banChatMember` followed by `unbanChatMember` (remove from group, without permanent block). Never kick the guard itself or existing members. New joiners already promoted to admin cannot be kicked by the Bot API; record the failure.
- Restore fixed title `閉鎖したグループ` and description `このグループは閉鎖され一切の機能を停止しています`, and delete the group photo whenever present, at startup and every 30 seconds.
- Preserve all existing administrator roles: never demote, kick, ban, or edit the blacklist.
- Failure retries with bounded backoff; state file stores update offset and permission-restored flag. A single dedicated bot token must not be used by a second polling/webhook runtime.

## Delivery mode: Long Polling (confirmed approach)
- This standalone guard uses Telegram Bot API `getUpdates` Long Polling. No public HTTP endpoint or G-ACE Webhook Gateway is needed.
- Existing `@ShowTimeLIVE_Bot` (Bot ID `8086265383`) is the original BAN bot; Master refreshed its token, and the old group administrator rights were verified. Do not request a new Bot identity.
- **Verified 2026-11-04:** `getWebhookInfo` reported an existing webhook to `ssh.inkognit.org`, `pending_update_count=199` and a recent TLS delivery error. The stale webhook blocks polling even though the guard code is correct.
- The guard pins the existing Bot API identity (`8086265383`) and refuses an unexpected token identity.\n- Pending updates from an old webhook are processed conservatively: join actions require a Telegram event timestamp no more than 120 seconds old (30 seconds future skew allowed); older/missing join timestamps never trigger a kick. Messages older than 47 hours are skipped instead of blocking the queue. This protects current members but does not retroactively repair old abuse.\n- The guard **refuses startup while any webhook is configured**. It never changes the Telegram delivery mode itself and never calls `drop_pending_updates`.
- Migration procedure: verify the one polling runtime and persistence, then explicitly call `deleteWebhook` with `drop_pending_updates=false`; immediately verify `getWebhookInfo.url` is empty and start the sole polling runtime. Handle the accumulated queue with caution: updates can be old, stale joins should not trigger arbitrary new bans, and a Telegram API queue is not a durable historical archive. Do not claim queue retention without observing it.
- Do not use G-ACE Webhook Gateway for this bot unless Master explicitly changes the delivery-mode decision.

## Before deployment (not yet satisfied)
1. Use only existing `@ShowTimeLIVE_Bot` (`8086265383`), with the refreshed token already provisioned privately on the authorized host. The retired `.env` token that returned HTTP 401 must not be reused. Check Bot-to-Bot Communication Mode and receipt of posts from other bots, particularly administrator bots.
2. Master must add that bot to G-JUMP with `can_delete_messages`, `can_restrict_members`, `can_change_info`. Other admins' ability to remove it, revert settings or send updates cannot be eliminated by Bot API.
3. No photo file or text input is needed: closure title and description are hard-coded and the canonical profile image state is **no image**.
4. Create `.env` from `.env.example`, populate token privately; do **not** commit `.env`. Prepare writable `state/` directory for container UID 100 (alpine guard user may vary; verify).
5. On the authorized deployment machine, after checks, run `docker compose up -d --build`; verify `getMe`, the group rights, permission restoration, photo deletion/title/description restoration and representative admin/user/bot message deletion. Test restart and repeat. No automatic deployment/merges are included.
6. Offline tests: `python3 -m unittest discover -s operations/legacy-group-guard -p 'test_*.py'`.

## Telegram platform limits
- Bot API `deleteMessage` is generally limited to recent (<48h) messages and cannot erase every service message; deletion occurs *after* delivery, not before display.
- Bots must receive the messages to delete them and join events to kick newcomers; check Bot-to-Bot Communication Mode and privacy/admin rights, and keep `chat_member` in `allowed_updates`. Joining accounts with administrator rights cannot be kicked by ordinary bot admin permissions. No blanket guarantee that every bot-originated post is delivered.
- Equally privileged adversarial admins can remove this Bot's rights. Without ownership/admin authorization no technical promise of permanent total lockdown.
- Deleted messages are not preserved in this app; existing blacklist records are not migrated or altered.

## Current evidence
Source safety updates prepared; offline tests, runtime credentials, deployment and E2E remain **NOT VERIFIED** as of this change. Old `TGbot_grp_system/.env` token returned HTTP 401. The userbot's rented phone number is no longer available and must **not** be relied on.
