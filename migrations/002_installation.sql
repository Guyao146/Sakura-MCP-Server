CREATE TABLE system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  encrypted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE installation_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  installed_version text,
  administrator_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO installation_state(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE system_admin_allowlist (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX system_settings_updated_idx ON system_settings(updated_at DESC);