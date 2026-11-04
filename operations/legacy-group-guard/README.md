# G-JUMP old-group defensive guard (isolated)

This is a **standalone** Bot API application, not the active GateApp-Bot deployment. It never logs into the retired userbot/virtual-number account. It operates **only** in confirmed old group `-1002374817170` and hard-refuses any other ID. Its code does not touch the new three boards.

## Functions
- Delete **all received new and edited posts**, including those from ordinary users, administrators and bots, plus visible join service messages. The bot must receive the update first; it cannot prevent transient visibility.
- Reconcile ordinary member send permissions to all-false at startup and every 30 seconds, including after an administrator relaxes them.\n- **Kick all newly joining users and bots** detected by `chat_member` or service updates: `banChatMember` followed by `unbanChatMember` (remove from group, without permanent block). Never kick the guard itself or existing members. New joiners already promoted to admin cannot be kicked by the Bot API; record the failure.
- Restore configured group title/description and the owner-approved local photo, at startup and every 30 seconds.
- Preserve all existing administrator roles: never demote, kick, ban, or edit the blacklist.
- Failure retries with bounded backoff; state file stores photo ID, offset, permission-restored flag. A single dedicated bot token must not be used by a second polling/webhook runtime.

## Before deployment (not yet satisfied)
1. Master must create or select a **working Telegram Bot API bot** in BotFather (the retired .env token returned HTTP 401). Configure Bot-to-Bot Communication Mode and test receipt of posts from other bots, particularly administrator bots.
2. Master must add that bot to G-JUMP with `can_delete_messages`, `can_restrict_members`, `can_change_info`. Other admins' ability to remove it, revert settings or send updates cannot be eliminated by Bot API.
3. Obtain **Master-approved** canonical title, description, and original photo file. Do not take these automatically from a potentially defaced group. Save `canonical.jpg` in this directory.
4. Create `.env` from `.env.example`, populate token and title/description privately; do **not** commit either `.env` or canonical photo. Prepare writable `state/` directory for container UID 100 (alpine guard user may vary; verify).
5. On the authorized deployment machine, after checks, run `docker compose up -d --build`; verify `getMe`, the group rights, permission restoration, image/title/description restoration and representative admin/user/bot message deletion. Test restart and repeat. No automatic deployment/merges are included.
6. Offline tests: `python3 -m unittest discover -s operations/legacy-group-guard -p 'test_*.py'`.

## Telegram platform limits
- Bot API `deleteMessage` is generally limited to recent (<48h) messages and cannot erase every service message; deletion occurs *after* delivery, not before display.
- Bots must receive the messages to delete them and join events to kick newcomers; check Bot-to-Bot Communication Mode and privacy/admin rights, and keep `chat_member` in `allowed_updates`. Joining accounts with administrator rights cannot be kicked by ordinary bot admin permissions. No blanket guarantee that every bot-originated post is delivered.
- Equally privileged adversarial admins can remove this Bot's rights. Without ownership/admin authorization no technical promise of permanent total lockdown.
- Deleted messages are not preserved in this app; existing blacklist records are not migrated or altered.

## Current evidence
Source prepared only. No runtime credentials, canonical media, deployment or E2E proof yet; old `TGbot_grp_system/.env` token returned HTTP 401. The userbot's rented phone number is no longer available and must **not** be relied on.
