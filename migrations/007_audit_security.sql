ALTER TABLE audit_logs
  ADD COLUMN auth_source text,
  ADD COLUMN request_id uuid DEFAULT gen_random_uuid();

CREATE INDEX audit_logs_action_created_idx ON audit_logs(action, created_at DESC);
CREATE INDEX audit_logs_result_created_idx ON audit_logs(result, created_at DESC);
CREATE INDEX audit_logs_request_idx ON audit_logs(request_id);