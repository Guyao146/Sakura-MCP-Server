ALTER TABLE space_provider_settings
  ADD COLUMN provider_type provider_type;

ALTER TABLE memory_embeddings
  ALTER COLUMN embedding DROP NOT NULL,
  ALTER COLUMN dimensions DROP NOT NULL;

ALTER TABLE memory_embeddings
  ADD CONSTRAINT memory_embedding_state_valid CHECK (
    (status = 'ready' AND embedding IS NOT NULL AND dimensions IS NOT NULL AND dimensions > 0)
    OR (status IN ('pending', 'failed'))
  );

CREATE INDEX memory_embeddings_status_idx ON memory_embeddings(status, updated_at);