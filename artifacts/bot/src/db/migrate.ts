import { pool } from "./index.js";

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        owner_user_id BIGINT PRIMARY KEY,
        nickname TEXT,
        username TEXT,
        height_cm SMALLINT NOT NULL CHECK (height_cm BETWEEN 100 AND 250),
        weight_kg SMALLINT NOT NULL CHECK (weight_kg BETWEEN 50 AND 250),
        age SMALLINT NOT NULL CHECK (age BETWEEN 18 AND 89),
        position TEXT NOT NULL CONSTRAINT profiles_position_check CHECK (position IN ('タチ','タチリバ','リバ','ウケリバ','ウケ','S','M')),
        hair TEXT, body TEXT, region TEXT, area TEXT, pr TEXT,
        status TEXT NOT NULL DEFAULT 'private'
          CHECK (status IN ('private','published','hidden')),
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pr_ref TEXT;
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS media_next_id BIGINT NOT NULL DEFAULT 1;
      ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_height_cm_check;
      ALTER TABLE profiles ADD CONSTRAINT profiles_height_cm_check CHECK (height_cm BETWEEN 100 AND 250) NOT VALID;
      ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_weight_kg_check;
      ALTER TABLE profiles ADD CONSTRAINT profiles_weight_kg_check CHECK (weight_kg BETWEEN 50 AND 250) NOT VALID;
      ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_age_check;
      ALTER TABLE profiles ADD CONSTRAINT profiles_age_check CHECK (age BETWEEN 18 AND 89) NOT VALID;
      ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_position_check;
      ALTER TABLE profiles ADD CONSTRAINT profiles_position_check CHECK (position IN ('タチ','タチリバ','リバ','ウケリバ','ウケ','S','M'));
      CREATE TABLE IF NOT EXISTS profile_tag_catalog (
        category TEXT NOT NULL,
        tag TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        PRIMARY KEY(category,tag)
      );
      CREATE TABLE IF NOT EXISTS profile_tags (
        owner_user_id BIGINT NOT NULL REFERENCES profiles(owner_user_id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK(purpose IN ('like','love')),
        category TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY(owner_user_id,purpose,category,tag),
        FOREIGN KEY(category,tag) REFERENCES profile_tag_catalog(category,tag)
      );
      CREATE TABLE IF NOT EXISTS profile_media (
        id BIGSERIAL PRIMARY KEY,
        owner_user_id BIGINT NOT NULL REFERENCES profiles(owner_user_id) ON DELETE CASCADE,
        file_id TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK(media_type IN ('photo','video')),
        public_allowed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE profile_media ADD COLUMN IF NOT EXISTS item_id BIGINT;
      WITH numbered AS (
        SELECT id,owner_user_id,
               ROW_NUMBER() OVER (PARTITION BY owner_user_id ORDER BY id) AS ordinal
        FROM profile_media WHERE item_id IS NULL
      ), maxima AS (
        SELECT owner_user_id,COALESCE(MAX(item_id),0) AS last_id
        FROM profile_media GROUP BY owner_user_id
      )
      UPDATE profile_media AS pm SET item_id=maxima.last_id+numbered.ordinal
      FROM numbered JOIN maxima ON maxima.owner_user_id=numbered.owner_user_id
      WHERE pm.id=numbered.id AND pm.item_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS profile_media_item_unique
        ON profile_media(owner_user_id,item_id) WHERE item_id IS NOT NULL;
      ALTER TABLE profile_media ADD COLUMN IF NOT EXISTS source_message_id BIGINT;
      ALTER TABLE profile_media ADD COLUMN IF NOT EXISTS media_group_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS profile_media_source_message_unique
        ON profile_media(owner_user_id,source_message_id)
        WHERE source_message_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS profile_publications (
        owner_user_id BIGINT NOT NULL REFERENCES profiles(owner_user_id) ON DELETE CASCADE,
        chat_id BIGINT NOT NULL CHECK(chat_id < 0),
        thread_id BIGINT NOT NULL CHECK(thread_id > 0),
        message_id BIGINT CHECK(message_id > 0),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','published','sync_error','hidden','delete_error')),
        synced_revision INTEGER,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(owner_user_id,chat_id,thread_id)
      );
      ALTER TABLE profile_publications ADD COLUMN IF NOT EXISTS public_snapshot JSONB;
      ALTER TABLE profile_publications ADD COLUMN IF NOT EXISTS pending_revision INTEGER;
      CREATE INDEX IF NOT EXISTS profile_pub_status_idx
        ON profile_publications(status);
      CREATE TABLE IF NOT EXISTS profile_view_links (
        owner_user_id BIGINT NOT NULL REFERENCES profiles(owner_user_id) ON DELETE CASCADE,
        profile_revision INTEGER NOT NULL CHECK(profile_revision > 0),
        topic_id BIGINT NOT NULL CHECK(topic_id > 0),
        token TEXT NOT NULL UNIQUE CHECK(length(token) = 32),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(owner_user_id,profile_revision,topic_id)
      );
      CREATE INDEX IF NOT EXISTS profile_view_links_owner_status
        ON profile_view_links(owner_user_id,enabled);
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
          ('terms','rules','safety','privacy','howto','search','menu')),
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
      -- Only independently verified navigation links are admitted to the
      -- posting panel. Bot DM entry tokens are generated by the existing
      -- menu owner on publish and never stored here as literal URLs.
      CREATE TABLE IF NOT EXISTS board_posting_menu_links (
        chat_id BIGINT NOT NULL CHECK (chat_id < 0),
        label TEXT NOT NULL CHECK (length(trim(label)) > 0),
        destination_url TEXT NOT NULL CHECK (length(trim(destination_url)) > 0),
        source TEXT NOT NULL CHECK (length(trim(source)) > 0),
        verified_by BIGINT,
        verified_at TIMESTAMPTZ,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        PRIMARY KEY (chat_id,label),
        CHECK (NOT enabled OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
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
      CREATE TABLE IF NOT EXISTS gaybbs_feature_release_gates (
        feature TEXT PRIMARY KEY CHECK(feature IN ('profile','announcement','room','link','search')),
        source_commit TEXT NOT NULL CHECK(length(source_commit)=40),
        ci_evidence TEXT NOT NULL,
        gserver_runtime_evidence TEXT NOT NULL,
        telegram_e2e_evidence TEXT NOT NULL,
        approved_by BIGINT NOT NULL,
        approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        enabled BOOLEAN NOT NULL DEFAULT FALSE
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
        purpose TEXT NOT NULL CHECK (purpose IN ('profile','room','announcement','link')),
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
        source_type TEXT NOT NULL CHECK (source_type IN ('profile','room','announcement','link')),
        source_id TEXT NOT NULL,
        owner_user_id BIGINT NOT NULL,
        source_revision INTEGER NOT NULL CHECK (source_revision > 0),
        posting_topic_id BIGINT NOT NULL REFERENCES posting_topics(topic_id),
        operation_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','needs_reconcile','failed','deleted','archived')),
        telegram_message_id BIGINT,
        inline_buttons JSONB,
        rendered_text TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE posting_deliveries ADD COLUMN IF NOT EXISTS inline_buttons JSONB;
      ALTER TABLE posting_deliveries ADD COLUMN IF NOT EXISTS rendered_text TEXT;

      CREATE TABLE IF NOT EXISTS public_post_drafts (
        owner_user_id BIGINT NOT NULL,
        module TEXT NOT NULL CHECK (module IN ('room','announcement','link')),
        step TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        revision INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (owner_user_id,module)
      );
      CREATE TABLE IF NOT EXISTS link_button_posts (
        link_post_id BIGSERIAL PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        owner_user_id BIGINT NOT NULL,
        content TEXT NOT NULL,
        buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
        columns INTEGER NOT NULL CHECK(columns BETWEEN 1 AND 3),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK(status IN ('draft','published','hidden','deleted')),
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS room_posts (
        room_id BIGSERIAL PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        owner_user_id BIGINT NOT NULL,
        title TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('jitsi','external')),
        join_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft','scheduled','ready','live','postponed','cancelled','finished')),
        join_visibility TEXT NOT NULL DEFAULT 'approved_only'
          CHECK(join_visibility IN ('approved_only','public')),
        start_at TIMESTAMPTZ,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE room_posts ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
      CREATE TABLE IF NOT EXISTS room_join_links (
        room_id BIGINT PRIMARY KEY REFERENCES room_posts(room_id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE CHECK(length(token)=32),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS room_host_sessions (
        owner_user_id BIGINT PRIMARY KEY,
        room_id BIGINT NOT NULL REFERENCES room_posts(room_id),
        expected_revision INTEGER NOT NULL CHECK(expected_revision > 0),
        requested_action TEXT NOT NULL CHECK(requested_action IN ('schedule','postpone','edit_details')),
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE room_host_sessions DROP CONSTRAINT IF EXISTS room_host_sessions_requested_action_check;
      ALTER TABLE room_host_sessions ADD CONSTRAINT room_host_sessions_requested_action_check
        CHECK(requested_action IN ('schedule','postpone','edit_details'));
      ALTER TABLE room_host_sessions ADD COLUMN IF NOT EXISTS screen_message_id INTEGER;
      CREATE TABLE IF NOT EXISTS room_source_events (
        event_id BIGSERIAL PRIMARY KEY,
        room_id BIGINT NOT NULL REFERENCES room_posts(room_id),
        source_revision INTEGER NOT NULL CHECK(source_revision > 0),
        kind TEXT NOT NULL CHECK(kind IN
          ('scheduled','prepared','started','postponed','cancelled','finished','visibility_changed','details_changed')),
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK(state IN ('pending','processing','applied','needs_reconcile')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(room_id,source_revision)
      );
      ALTER TABLE room_source_events DROP CONSTRAINT IF EXISTS room_source_events_kind_check;
      ALTER TABLE room_source_events ADD CONSTRAINT room_source_events_kind_check
        CHECK(kind IN ('scheduled','prepared','started','postponed','cancelled',
          'finished','visibility_changed','details_changed'));
      CREATE TABLE IF NOT EXISTS room_participation_reports (
        report_id BIGSERIAL PRIMARY KEY,
        room_id BIGINT NOT NULL REFERENCES room_posts(room_id),
        reporter_user_id BIGINT NOT NULL,
        report_type TEXT NOT NULL CHECK(report_type IN ('join_failed','left')),
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS announcement_posts (
        announcement_id BIGSERIAL PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        owner_user_id BIGINT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('announcement','preview','recruitment')),
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft','scheduled','publishing','published','closed','filled',
                           'cancelled','finished','sync_error','needs_reconcile')),
        accept_applications BOOLEAN NOT NULL DEFAULT FALSE,
        profile_snapshot JSONB,
        conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
        area_code TEXT,
        scheduled_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        expiry_action TEXT NOT NULL DEFAULT 'close'
          CHECK (expiry_action IN ('close','delete_post')),
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
      CREATE TABLE IF NOT EXISTS announcement_applications (
        application_id BIGSERIAL PRIMARY KEY,
        announcement_id BIGINT NOT NULL REFERENCES announcement_posts(announcement_id),
        applicant_user_id BIGINT NOT NULL,
        consented_profile JSONB,
        status TEXT NOT NULL DEFAULT 'submitted'
          CHECK(status IN ('submitted','held','accepted','declined','withdrawn','expired')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(announcement_id,applicant_user_id)
      );
      CREATE TABLE IF NOT EXISTS announcement_room_dispatches (
        dispatch_id BIGSERIAL PRIMARY KEY,
        announcement_id BIGINT NOT NULL REFERENCES announcement_posts(announcement_id),
        room_event_id BIGINT NOT NULL REFERENCES room_source_events(event_id),
        source_revision INTEGER NOT NULL CHECK(source_revision > 0),
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK(state IN ('pending','sending','sent','needs_reconcile','skipped')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(announcement_id,room_event_id)
      );
      CREATE TABLE IF NOT EXISTS room_status_message_edits (
        edit_id BIGSERIAL PRIMARY KEY,
        room_event_id BIGINT NOT NULL REFERENCES room_source_events(event_id),
        delivery_id BIGINT NOT NULL REFERENCES posting_deliveries(delivery_id),
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK(state IN ('pending','sending','confirmed','needs_reconcile')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(room_event_id,delivery_id)
      );
      CREATE TABLE IF NOT EXISTS announcement_application_entries (
        token_hash TEXT PRIMARY KEY,
        announcement_id BIGINT NOT NULL REFERENCES announcement_posts(announcement_id),
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS announcement_application_sessions (
        applicant_user_id BIGINT PRIMARY KEY,
        token_hash TEXT NOT NULL REFERENCES announcement_application_entries(token_hash),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS announcement_notifications (
        notification_id BIGSERIAL PRIMARY KEY,
        announcement_id BIGINT NOT NULL REFERENCES announcement_posts(announcement_id),
        recipient_user_id BIGINT NOT NULL,
        event_key TEXT NOT NULL UNIQUE,
        payload JSONB NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK(state IN ('pending','sending','sent','needs_reconcile','failed')),
        sent_at TIMESTAMPTZ
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
