import { pool } from "./index.js";

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        owner_user_id BIGINT PRIMARY KEY,
        nickname TEXT,
        username TEXT,
        height_cm SMALLINT NOT NULL CHECK (height_cm BETWEEN 90 AND 250),
        weight_kg SMALLINT NOT NULL CHECK (weight_kg BETWEEN 25 AND 300),
        age SMALLINT NOT NULL CHECK (age BETWEEN 20 AND 120),
        position TEXT NOT NULL CHECK (position IN ('タチ','タチリバ','リバ','ウケリバ','ウケ')),
        hair TEXT, body TEXT, region TEXT, area TEXT, pr TEXT,
        status TEXT NOT NULL DEFAULT 'private'
          CHECK (status IN ('private','published','hidden')),
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS general_guide_topics (
        chat_id BIGINT PRIMARY KEY CHECK(chat_id < 0),
        message_thread_id BIGINT NOT NULL CHECK(message_thread_id > 0),
        verified_by BIGINT NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        enabled BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE IF NOT EXISTS general_guide_documents (
        chat_id BIGINT NOT NULL REFERENCES general_guide_topics(chat_id),
        document_type TEXT NOT NULL CHECK(document_type IN
          ('terms','rules','safety','howto','search','menu')),
        message_id BIGINT CHECK(message_id > 0),
        content TEXT,
        version TEXT,
        approved_by BIGINT,
        approved_at TIMESTAMPTZ,
        synced_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK(status IN ('draft','approved','publishing','published','needs_reconcile','retired')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(chat_id,document_type),
        CHECK(status NOT IN ('approved','publishing','published') OR
          (approved_by IS NOT NULL AND approved_at IS NOT NULL AND version IS NOT NULL)),
        CHECK(status <> 'published' OR message_id IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS general_guide_links (
        chat_id BIGINT NOT NULL REFERENCES general_guide_topics(chat_id),
        link_key TEXT NOT NULL,
        label TEXT NOT NULL,
        destination_url TEXT NOT NULL,
        source TEXT NOT NULL,
        verified_by BIGINT,
        verified_at TIMESTAMPTZ,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        PRIMARY KEY(chat_id,link_key),
        CHECK(NOT enabled OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS board_menu_panels (
        panel_id BIGSERIAL PRIMARY KEY,
        chat_id BIGINT NOT NULL CHECK(chat_id < 0),
        message_thread_id BIGINT NOT NULL CHECK(message_thread_id > 0),
        panel_type TEXT NOT NULL CHECK(panel_type IN ('general_guide','posting')),
        message_id BIGINT CHECK(message_id > 0),
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        revision INTEGER NOT NULL DEFAULT 1,
        state TEXT NOT NULL DEFAULT 'unverified'
          CHECK(state IN ('unverified','verified','publishing','published','needs_reconcile','retired')),
        verified_by BIGINT,
        verified_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(chat_id,message_thread_id,panel_type)
      );
      CREATE TABLE IF NOT EXISTS board_menu_entry_tokens (
        token_hash TEXT PRIMARY KEY,
        panel_id BIGINT NOT NULL REFERENCES board_menu_panels(panel_id),
        feature TEXT NOT NULL CHECK(feature IN ('profile','announcement','room','link','search')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE IF NOT EXISTS board_menu_sessions (
        owner_user_id BIGINT PRIMARY KEY,
        token_hash TEXT NOT NULL REFERENCES board_menu_entry_tokens(token_hash),
        feature TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS posting_topics (
        topic_id BIGSERIAL PRIMARY KEY,
        board_key TEXT NOT NULL CHECK (board_key IN ('area_bbs','video_chat','gay_board')),
        purpose TEXT NOT NULL CHECK (purpose IN ('profile','room','announcement')),
        chat_id BIGINT NOT NULL CHECK (chat_id < 0),
        message_thread_id BIGINT NOT NULL CHECK (message_thread_id > 0),
        title TEXT NOT NULL,
        verified_by BIGINT,
        verified_at TIMESTAMPTZ,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE (board_key,purpose,chat_id,message_thread_id),
        CHECK (NOT enabled OR (verified_at IS NOT NULL AND verified_by IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS posting_deliveries (
        delivery_id BIGSERIAL PRIMARY KEY,
        source_type TEXT NOT NULL CHECK (source_type IN ('profile','room','announcement')),
        source_id TEXT NOT NULL,
        owner_user_id BIGINT NOT NULL,
        source_revision INTEGER NOT NULL CHECK (source_revision > 0),
        posting_topic_id BIGINT NOT NULL REFERENCES posting_topics(topic_id),
        operation_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','needs_reconcile','failed','deleted')),
        telegram_message_id BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public_post_drafts (
        owner_user_id BIGINT NOT NULL,
        module TEXT NOT NULL CHECK (module IN ('room','announcement')),
        step TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (owner_user_id,module)
      );
      CREATE TABLE IF NOT EXISTS room_posts (
        room_id BIGSERIAL PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        owner_user_id BIGINT NOT NULL,
        title TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('jitsi','external')),
        join_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft','scheduled','ready','cancelled','finished')),
        start_at TIMESTAMPTZ,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS announcement_posts (
        announcement_id BIGSERIAL PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        owner_user_id BIGINT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('announcement','preview','recruitment')),
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft','published','closed','cancelled')),
        event_at TIMESTAMPTZ,
        publish_at TIMESTAMPTZ,
        deadline_at TIMESTAMPTZ,
        capacity INTEGER,
        purpose_codes TEXT[] NOT NULL DEFAULT '{}',
        place_codes TEXT[] NOT NULL DEFAULT '{}',
        room_id BIGINT REFERENCES room_posts(room_id),
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE announcement_posts ADD COLUMN IF NOT EXISTS purpose_codes TEXT[] NOT NULL DEFAULT '{}';
      ALTER TABLE announcement_posts ADD COLUMN IF NOT EXISTS place_codes TEXT[] NOT NULL DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS profile_drafts (
        owner_user_id BIGINT PRIMARY KEY,
        step TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS owners (
        owner_user_id BIGINT PRIMARY KEY,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS targets (
        target_id SERIAL PRIMARY KEY,
        owner_user_id BIGINT NOT NULL,
        target_type TEXT NOT NULL,
        chat_id BIGINT NOT NULL,
        title TEXT NOT NULL,
        gate_code TEXT NOT NULL UNIQUE,
        log_chat_id BIGINT,
        log_thread_id BIGINT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bot_challenges (
        challenge_id SERIAL PRIMARY KEY,
        target_id INTEGER NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        difficulty TEXT NOT NULL DEFAULT 'standard',
        max_fail INTEGER NOT NULL DEFAULT 3,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS questions (
        question_id SERIAL PRIMARY KEY,
        target_id INTEGER NOT NULL,
        order_index INTEGER NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        question_text TEXT NOT NULL DEFAULT '',
        button1_label TEXT NOT NULL DEFAULT '',
        button2_label TEXT NOT NULL DEFAULT '',
        button3_label TEXT NOT NULL DEFAULT '',
        correct_button INTEGER NOT NULL DEFAULT 1,
        next_label TEXT NOT NULL DEFAULT '次へ',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(target_id, order_index)
      );

      CREATE TABLE IF NOT EXISTS rules (
        rule_id SERIAL PRIMARY KEY,
        target_id INTEGER NOT NULL UNIQUE,
        rule_text TEXT NOT NULL DEFAULT '',
        accept_label TEXT NOT NULL DEFAULT '同意する',
        reject_label TEXT NOT NULL DEFAULT '同意しない',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS approvals (
        approval_id SERIAL PRIMARY KEY,
        target_id INTEGER NOT NULL,
        tg_user_id BIGINT NOT NULL,
        username TEXT,
        display_name TEXT,
        is_premium BOOLEAN DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'pending',
        rejected_reason TEXT,
        approved_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS invite_links (
        invite_id SERIAL PRIMARY KEY,
        target_id INTEGER NOT NULL,
        tg_user_id BIGINT NOT NULL,
        invite_link TEXT NOT NULL,
        expire_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS blacklist (
        user_id BIGINT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'blocked',
        reason TEXT,
        source TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS log_groups (
        log_group_id SERIAL PRIMARY KEY,
        owner_user_id BIGINT NOT NULL,
        chat_id BIGINT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS log_topics (
        log_topic_id SERIAL PRIMARY KEY,
        log_group_id INTEGER NOT NULL,
        thread_id BIGINT NOT NULL,
        title TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gate_sessions (
        tg_user_id BIGINT PRIMARY KEY,
        target_id INTEGER NOT NULL,
        step TEXT NOT NULL DEFAULT 'start',
        challenge_fails INTEGER NOT NULL DEFAULT 0,
        challenge_data JSONB,
        last_message_id INTEGER,
        last_attempt TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      ALTER TABLE gate_sessions ADD COLUMN IF NOT EXISTS challenge_data JSONB;
      ALTER TABLE gate_sessions ADD COLUMN IF NOT EXISTS last_message_id INTEGER;

      CREATE TABLE IF NOT EXISTS admin_sessions (
        tg_user_id BIGINT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'top',
        target_id INTEGER,
        log_group_id INTEGER,
        awaiting_input TEXT,
        temp_data TEXT,
        last_message_id INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS last_message_id INTEGER;

      ALTER TABLE targets ADD COLUMN IF NOT EXISTS approval_media_file_id TEXT;
      ALTER TABLE targets ADD COLUMN IF NOT EXISTS approval_media_type TEXT;
      ALTER TABLE targets ADD COLUMN IF NOT EXISTS approval_caption TEXT;
      ALTER TABLE targets ADD COLUMN IF NOT EXISTS invite_counter INTEGER NOT NULL DEFAULT 0;
    `);
  } finally {
    client.release();
  }
}
