ALTER TABLE memory_relations
  ADD CONSTRAINT memory_relation_not_self CHECK (from_memory_id <> to_memory_id);

ALTER TABLE memory_conflicts
  ADD CONSTRAINT memory_conflict_not_self CHECK (memory_a_id <> memory_b_id);

CREATE UNIQUE INDEX one_open_conflict_per_pair ON memory_conflicts(
  LEAST(memory_a_id, memory_b_id), GREATEST(memory_a_id, memory_b_id)
) WHERE status = 'open';

CREATE INDEX memory_conflicts_space_status_idx ON memory_conflicts(space_id, status, created_at DESC);
CREATE INDEX memory_relations_space_idx ON memory_relations(space_id, created_at DESC);