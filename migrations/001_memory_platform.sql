CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE space_type AS ENUM ('personal', 'shared', 'system', 'agent_private');
CREATE TYPE space_role AS ENUM ('owner', 'admin', 'editor', 'contributor', 'viewer');
CREATE TYPE memory_status AS ENUM ('active', 'pending_confirmation', 'superseded', 'archived', 'deleted');
CREATE TYPE memory_type AS ENUM ('fact', 'preference', 'event', 'task', 'person', 'project', 'summary', 'document', 'idea', 'other');
CREATE TYPE provider_type AS ENUM ('openai_compatible', 'ollama');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_subject text UNIQUE NOT NULL,
  email text,
  display_name text NOT NULL,
  avatar_url text,
  is_system_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type space_type NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  auto_extract_enabled boolean NOT NULL DEFAULT false,
  auto_merge_enabled boolean NOT NULL DEFAULT false,
  conflict_detection_enabled boolean NOT NULL DEFAULT true,
  privacy_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX one_personal_space_per_user ON spaces(created_by) WHERE type = 'personal' AND deleted_at IS NULL;

CREATE TABLE space_members (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role space_role NOT NULL,
  invited_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);

CREATE TABLE space_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role space_role NOT NULL,
  invited_by uuid NOT NULL REFERENCES users(id),
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pending_space_invitation ON space_invitations(space_id, lower(email)) WHERE accepted_at IS NULL;

CREATE TABLE agent_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  key_prefix text NOT NULL,
  secret_hash text UNIQUE NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_space_grants (
  agent_id uuid NOT NULL REFERENCES agent_credentials(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  scopes text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (agent_id, space_id)
);

CREATE TABLE provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type provider_type NOT NULL,
  base_url text NOT NULL,
  encrypted_api_key text,
  chat_model text,
  embedding_model text,
  embedding_dimensions integer CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE space_provider_settings (
  space_id uuid PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
  provider_config_id uuid REFERENCES provider_configs(id) ON DELETE SET NULL,
  chat_model text,
  embedding_model text,
  embedding_dimensions integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  type memory_type NOT NULL DEFAULT 'other',
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000000),
  summary text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  importance real NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  confidence real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  sensitivity smallint NOT NULL DEFAULT 0 CHECK (sensitivity BETWEEN 0 AND 3),
  status memory_status NOT NULL DEFAULT 'active',
  valid_from timestamptz,
  valid_until timestamptz,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  source_agent_id uuid REFERENCES agent_credentials(id) ON DELETE SET NULL,
  supersedes_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(summary, '') || ' ' || content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX memories_space_status_idx ON memories(space_id, status, updated_at DESC);
CREATE INDEX memories_search_idx ON memories USING gin(search_vector);
CREATE INDEX memories_tags_idx ON memories USING gin(tags);

CREATE TABLE memory_embeddings (
  memory_id uuid PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  provider_config_id uuid REFERENCES provider_configs(id) ON DELETE SET NULL,
  model text NOT NULL,
  dimensions integer NOT NULL,
  embedding vector NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready', 'failed')),
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memory_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(memory_id, version)
);

CREATE TABLE memory_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_uri text,
  source_agent text,
  excerpt text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memory_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  from_memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  to_memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  confidence real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(from_memory_id, to_memory_id, relation_type)
);

CREATE TABLE memory_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  memory_a_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  memory_b_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution jsonb,
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE memory_feedback (
  memory_id uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helpful boolean,
  correction text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(memory_id, user_id)
);

CREATE TABLE ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  progress jsonb NOT NULL DEFAULT '{}',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES agent_credentials(id) ON DELETE SET NULL,
  space_id uuid REFERENCES spaces(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  result text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_actor_idx ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX audit_logs_space_idx ON audit_logs(space_id, created_at DESC);
