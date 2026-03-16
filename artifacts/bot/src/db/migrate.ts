import { pool } from "./index.js";

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
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
        last_attempt TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      ALTER TABLE gate_sessions ADD COLUMN IF NOT EXISTS challenge_data JSONB;

      CREATE TABLE IF NOT EXISTS admin_sessions (
        tg_user_id BIGINT PRIMARY KEY,
        state TEXT NOT NULL DEFAULT 'top',
        target_id INTEGER,
        log_group_id INTEGER,
        awaiting_input TEXT,
        temp_data TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}
