-- Store Agent secrets encrypted so the console can reveal them again instead of
-- showing the token only once. The plaintext is never stored: the AES-256-GCM
-- envelope is sealed with CONFIG_ENCRYPTION_KEY, and secret_hash stays the only
-- value used for authentication. Rows created before this migration have no
-- envelope and therefore remain unrecoverable.
ALTER TABLE agent_credentials ADD COLUMN secret_encrypted jsonb;
