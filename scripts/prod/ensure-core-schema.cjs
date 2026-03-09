#!/usr/bin/env node

const { Client } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `CREATE TABLE IF NOT EXISTS users (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    username text,
    password text,
    email text UNIQUE,
    first_name varchar,
    last_name varchar,
    full_name varchar,
    profile_image_url varchar,
    phone varchar,
    company varchar,
    role text DEFAULT 'USER',
    plan text DEFAULT 'free',
    status text DEFAULT 'active',
    query_count integer DEFAULT 0,
    tokens_consumed integer DEFAULT 0,
    tokens_limit integer DEFAULT 100000,
    credits_balance integer DEFAULT 0,
    last_login_at timestamp,
    last_ip varchar,
    user_agent text,
    country_code varchar(2),
    auth_provider text DEFAULT 'email',
    is_2fa_enabled text DEFAULT 'false',
    email_verified text DEFAULT 'false',
    phone_verified text DEFAULT 'false',
    referral_code varchar,
    referred_by varchar,
    internal_notes text,
    tags text[],
    subscription_expires_at timestamp,
    daily_requests_used integer DEFAULT 0,
    daily_requests_limit integer DEFAULT 3,
    daily_requests_reset_at timestamp,
    stripe_customer_id text,
    stripe_subscription_id text,
    totp_secret text,
    totp_enabled boolean DEFAULT false,
    login_count integer DEFAULT 0,
    subscription_status text,
    subscription_plan text,
    subscription_period_end timestamp,
    monthly_token_limit integer,
    monthly_tokens_used integer,
    tokens_reset_at timestamp,
    preferences jsonb,
    org_id text DEFAULT 'default',
    network_access_enabled boolean DEFAULT false,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    deleted_at timestamp,
    CONSTRAINT users_credits_balance_check CHECK (credits_balance >= 0)
  );`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    user_id varchar NOT NULL UNIQUE,
    response_preferences jsonb,
    user_profile jsonb,
    feature_flags jsonb,
    privacy_settings jsonb,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS magic_links (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    user_id varchar NOT NULL,
    token varchar NOT NULL UNIQUE,
    expires_at timestamp NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state varchar(255) PRIMARY KEY NOT NULL,
    return_url text DEFAULT '/' NOT NULL,
    provider varchar(50) DEFAULT 'google' NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL,
    expires_at timestamp NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    user_id varchar NOT NULL,
    provider varchar(50) NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    expires_at bigint,
    scope text,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS ai_models (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    status text DEFAULT 'active',
    cost_per_1k text DEFAULT '0.00',
    usage_percent integer DEFAULT 0,
    description text,
    capabilities jsonb,
    model_type text DEFAULT 'TEXT',
    context_window integer,
    max_output_tokens integer,
    input_cost_per_1k text DEFAULT '0.00',
    output_cost_per_1k text DEFAULT '0.00',
    last_sync_at timestamp,
    last_synced_at timestamp,
    is_deprecated text DEFAULT 'false',
    release_date text,
    is_enabled text DEFAULT 'false',
    enabled_at timestamp,
    enabled_by_admin_id varchar,
    display_order integer DEFAULT 0,
    icon text,
    created_at timestamp DEFAULT now() NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS chats (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    user_id varchar,
    title text DEFAULT 'New Chat' NOT NULL,
    gpt_id varchar,
    archived text DEFAULT 'false',
    hidden text DEFAULT 'false',
    pinned text DEFAULT 'false',
    pinned_at timestamp,
    deleted_at timestamp,
    last_message_at timestamp,
    message_count integer DEFAULT 0,
    tokens_used integer DEFAULT 0,
    ai_model_used text,
    conversation_status text DEFAULT 'active',
    flag_status text,
    ended_at timestamp,
    created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp DEFAULT now() NOT NULL,
    CONSTRAINT chats_message_count_check CHECK (message_count >= 0),
    CONSTRAINT chats_tokens_used_check CHECK (tokens_used >= 0)
  );`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    chat_id varchar NOT NULL,
    run_id varchar,
    role text NOT NULL,
    content text NOT NULL,
    status text DEFAULT 'done',
    request_id varchar,
    user_message_id varchar,
    sequence integer,
    attachments jsonb,
    sources jsonb,
    figma_diagram jsonb,
    google_form_preview jsonb,
    gmail_preview jsonb,
    generated_image text,
    metadata jsonb,
    search_vector tsvector,
    created_at timestamp DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_content_check CHECK (length(content) > 0)
  );`,
  `CREATE TABLE IF NOT EXISTS chat_runs (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    chat_id varchar NOT NULL,
    client_request_id varchar NOT NULL,
    user_message_id varchar,
    assistant_message_id varchar,
    status text DEFAULT 'pending' NOT NULL,
    last_seq integer DEFAULT 0,
    error text,
    metadata jsonb,
    created_at timestamp DEFAULT now() NOT NULL,
    started_at timestamp,
    completed_at timestamp
  );`,
  `CREATE TABLE IF NOT EXISTS tool_invocations (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    run_id varchar NOT NULL,
    tool_call_id varchar NOT NULL,
    tool_name text NOT NULL,
    input jsonb,
    output jsonb,
    status text DEFAULT 'pending' NOT NULL,
    error text,
    created_at timestamp DEFAULT now() NOT NULL,
    completed_at timestamp
  );`,
  `CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);`,
  `CREATE INDEX IF NOT EXISTS users_plan_idx ON users (plan);`,
  `CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);`,
  `CREATE INDEX IF NOT EXISTS users_last_login_at_idx ON users (last_login_at);`,
  `CREATE INDEX IF NOT EXISTS users_referral_code_idx ON users (referral_code);`,
  `CREATE INDEX IF NOT EXISTS users_stripe_subscription_id_idx ON users (stripe_subscription_id);`,
  `CREATE INDEX IF NOT EXISTS users_tags_idx ON users USING gin (tags);`,
  `CREATE INDEX IF NOT EXISTS user_settings_user_id_idx ON user_settings (user_id);`,
  `CREATE INDEX IF NOT EXISTS magic_links_token_idx ON magic_links (token);`,
  `CREATE INDEX IF NOT EXISTS magic_links_user_idx ON magic_links (user_id);`,
  `CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON oauth_states (expires_at);`,
  `CREATE INDEX IF NOT EXISTS auth_tokens_user_provider_idx ON auth_tokens (user_id, provider);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_unique_user_provider ON auth_tokens (user_id, provider);`,
  `CREATE INDEX IF NOT EXISTS ai_models_provider_idx ON ai_models (provider);`,
  `CREATE INDEX IF NOT EXISTS ai_models_model_type_idx ON ai_models (model_type);`,
  `CREATE INDEX IF NOT EXISTS ai_models_status_idx ON ai_models (status);`,
  `CREATE INDEX IF NOT EXISTS ai_models_is_enabled_idx ON ai_models (is_enabled);`,
  `CREATE INDEX IF NOT EXISTS chats_user_idx ON chats (user_id);`,
  `CREATE INDEX IF NOT EXISTS chats_status_idx ON chats (conversation_status);`,
  `CREATE INDEX IF NOT EXISTS chats_flag_idx ON chats (flag_status);`,
  `CREATE INDEX IF NOT EXISTS chats_user_updated_idx ON chats (user_id, updated_at);`,
  `CREATE INDEX IF NOT EXISTS chats_user_archived_deleted_idx ON chats (user_id, archived, deleted_at);`,
  `CREATE INDEX IF NOT EXISTS chats_updated_at_idx ON chats (updated_at);`,
  `CREATE INDEX IF NOT EXISTS chats_gpt_id_idx ON chats (gpt_id);`,
  `CREATE INDEX IF NOT EXISTS chats_pinned_idx ON chats (pinned);`,
  `CREATE INDEX IF NOT EXISTS chats_active_inbox_idx ON chats (conversation_status, archived);`,
  `CREATE INDEX IF NOT EXISTS chat_messages_chat_idx ON chat_messages (chat_id);`,
  `CREATE INDEX IF NOT EXISTS chat_messages_request_idx ON chat_messages (request_id);`,
  `CREATE INDEX IF NOT EXISTS chat_messages_status_idx ON chat_messages (status);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_request_unique ON chat_messages (request_id);`,
  `CREATE INDEX IF NOT EXISTS chat_messages_chat_created_idx ON chat_messages (chat_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON chat_messages (created_at);`,
  `CREATE INDEX IF NOT EXISTS chat_messages_role_idx ON chat_messages (role);`,
  `CREATE INDEX IF NOT EXISTS chat_messages_sequence_idx ON chat_messages (sequence);`,
  `CREATE INDEX IF NOT EXISTS chat_messages_metadata_idx ON chat_messages USING gin (metadata);`,
  `CREATE INDEX IF NOT EXISTS chat_runs_chat_idx ON chat_runs (chat_id);`,
  `CREATE INDEX IF NOT EXISTS chat_runs_status_idx ON chat_runs (status);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS chat_runs_client_request_unique ON chat_runs (chat_id, client_request_id);`,
  `CREATE INDEX IF NOT EXISTS chat_runs_chat_created_idx ON chat_runs (chat_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS tool_invocations_run_idx ON tool_invocations (run_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tool_invocations_unique ON tool_invocations (run_id, tool_call_id);`,
  `CREATE INDEX IF NOT EXISTS tool_invocations_run_created_idx ON tool_invocations (run_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS tool_invocations_tool_name_idx ON tool_invocations (tool_name);`,
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    for (const statement of statements) {
      const head = statement.split("\n")[0];
      console.log(`RUN ${head}`);
      await client.query(statement);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
