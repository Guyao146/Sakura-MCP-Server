ALTER TABLE ingestion_jobs
  ADD COLUMN job_type text NOT NULL DEFAULT 'memory_import',
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN locked_by text,
  ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;

CREATE INDEX ingestion_jobs_queue_idx ON ingestion_jobs(status, available_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX ingestion_jobs_space_created_idx ON ingestion_jobs(space_id, created_at DESC);