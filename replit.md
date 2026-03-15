# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains a Telegram 参加承認ゲートBot and supporting infrastructure.

**本番稼働最適化完了：** DB接続プール、グレースフルシャットダウン、自動セッション削除、エラーリカバリー機能を実装済み。

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Telegram Bot**: telegraf v4

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   ├── bot/                # Telegram Gate Bot
│   └── mockup-sandbox/     # UI prototyping sandbox
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml     # pnpm workspace config
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package
```

## Telegram Gate Bot (`artifacts/bot`)

### Purpose

A Telegram Gate Bot that controls group/channel membership via an approval flow:
1. Blacklist check
2. Username required check
3. Bot anti-spam challenge
4. Up to 3 custom participation questions
5. Rules acceptance
6. One-time invite link generation
7. Logging to supergroup topics

### Key Files

- `src/index.ts` — Entry point, runs DB migrations then starts bot
- `src/db/migrate.ts` — SQL migration (CREATE TABLE IF NOT EXISTS for all tables)
- `src/db/schema/` — Drizzle schema files for all entities
- `src/bot/startHandler.ts` — `/start` command + gate flow entry
- `src/bot/menuHandlers.ts` — Admin management UI (all callback actions)
- `src/bot/gateHandlers.ts` — Participant approval flow (challenge/questions/rules)
- `src/bot/textHandlers.ts` — Text input handler for admin settings + forward detection
- `src/bot/keyboards.ts` — All inline keyboard builders
- `src/services/` — Business logic (blacklist, challenge, logging, invite)
- `src/repositories/` — DB access layer

### DB Schema (10 entities)

- `owners` — Admin users
- `targets` — Entry groups/channels and log groups
- `bot_challenges` — Per-target Bot anti-spam settings
- `questions` — Per-target participation questions (max 3)
- `rules` — Per-target rules text
- `approvals` — Approval records per user/target
- `invite_links` — One-time invite links
- `blacklist` — Blocked users
- `log_groups` — Supergroups for logging
- `log_topics` — Forum topics within log groups
- `gate_sessions` — Participant flow state
- `admin_sessions` — Admin menu navigation state

### Environment Variables

- `BOT_TOKEN` — Telegram Bot token (required)
- `DATABASE_URL` — PostgreSQL connection string (required, auto-set by Replit)
- `ADMIN_USER_IDS` — Comma-separated admin Telegram user IDs (optional; first user becomes admin if empty)
- `COOLDOWN_SECONDS` — Anti-spam cooldown in seconds (default: 300)

### Admin Setup Flow

1. Open bot DM in Telegram
2. Send `/start`
3. First user automatically becomes admin (or use ADMIN_USER_IDS env var)
4. Use button menus to add groups/channels/log groups, configure questions, rules, etc.
5. Share the gate link with users

### Adding a Group/Channel

1. Admin → "新しく追加" → target type
2. Forward any message from the target group/channel to the bot DM
3. Bot registers it and shows the gate link

### Adding a Log Group

1. Admin → "新しく追加" → "ログ用グループ追加"
2. Forward message from a supergroup
3. Create topics via "トピック管理"
4. Link topics to entry targets via "ログ保存先"

### Gate Link Format

`https://t.me/<bot_username>?start=gate_<gate_code>`

`gate_code` is a 12-character hex string unique per target.

### Participant Flow

`/start gate_<code>` → blacklist check → username check → bot challenge → q1/q2/q3 → rules → one-time invite link DM

### Log Format

Logs are sent to a supergroup topic:
- 承認 / 非承認 / キック
- 🕒 datetime, 📍 target, 🆔 user_id, 👤 display_name, 🔗 @username, ⭐ premium
- Reason emoji per event type

### Run Commands

- Dev: `pnpm --filter @workspace/bot run dev`
- DB push: `pnpm --filter @workspace/bot run db:push`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Provides health endpoint and general API infrastructure.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec and Orval config for code generation.
