import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('memory database schema', () => {
  it('defines every multi-tenant memory platform table', async () => {
    const sql = await readFile(new URL('../migrations/001_memory_platform.sql', import.meta.url), 'utf8');
    for (const table of [
      'users', 'spaces', 'space_members', 'space_invitations', 'agent_credentials', 'agent_space_grants',
      'provider_configs', 'space_provider_settings', 'memories', 'memory_embeddings', 'memory_versions',
      'memory_sources', 'memory_relations', 'memory_conflicts', 'memory_feedback', 'ingestion_jobs', 'audit_logs'
    ]) expect(sql).toContain(`CREATE TABLE ${table}`);
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector');
  });

  it('does not store invitation or Agent secrets in plaintext columns', async () => {
    const sql = await readFile(new URL('../migrations/001_memory_platform.sql', import.meta.url), 'utf8');
    expect(sql).toContain('token_hash text UNIQUE NOT NULL');
    expect(sql).toContain('secret_hash text UNIQUE NOT NULL');
    expect(sql).not.toMatch(/\b(secret|token)\s+text\b/);
  });

  it('defines locked installation state and encrypted system settings', async () => {
    const sql = await readFile(new URL('../migrations/002_installation.sql', import.meta.url), 'utf8');
    for (const table of ['system_settings', 'installation_state', 'system_admin_allowlist']) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain('encrypted boolean NOT NULL DEFAULT false');
    expect(sql).toContain('completed boolean NOT NULL DEFAULT false');
  });

  it('defines expiring OIDC attempts and hashed Web sessions', async () => {
    const sql = await readFile(new URL('../migrations/003_web_sessions.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE oidc_login_attempts');
    expect(sql).toContain('CREATE TABLE web_sessions');
    expect(sql).toContain('state_hash text PRIMARY KEY');
    expect(sql).toContain('token_hash text UNIQUE NOT NULL');
  });

  it('allows failed semantic jobs without fake vectors', async () => {
    const sql = await readFile(new URL('../migrations/004_semantic_memory.sql', import.meta.url), 'utf8');
    expect(sql).toContain('ADD COLUMN provider_type provider_type');
    expect(sql).toContain('ALTER COLUMN embedding DROP NOT NULL');
    expect(sql).toContain("status IN ('pending', 'failed')");
  });

  it('prevents duplicate open conflicts and self relations', async () => {
    const sql = await readFile(new URL('../migrations/005_memory_governance.sql', import.meta.url), 'utf8');
    expect(sql).toContain('memory_relation_not_self');
    expect(sql).toContain('memory_conflict_not_self');
    expect(sql).toContain('one_open_conflict_per_pair');
  });

  it('exposes portable MCP memory resources without file URIs', async () => {
    const source = await readFile(new URL('../src/tools.ts', import.meta.url), 'utf8');
    expect(source).toContain("'memory://spaces'");
    expect(source).toContain("'memory://spaces/{spaceId}'");
    expect(source).toContain("'memory://memories/{memoryId}'");
    expect(source).not.toContain("'file://");
  });

  it('defines a recoverable PostgreSQL background queue', async () => {
    const sql = await readFile(new URL('../migrations/006_background_jobs.sql', import.meta.url), 'utf8');
    expect(sql).toContain('locked_by text');
    expect(sql).toContain('cancel_requested boolean');
    expect(sql).toContain('ingestion_jobs_queue_idx');
  });

  it('supports Compose startup without a host .env file', async () => {
    const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
    expect(compose).toContain('bootstrap-secrets:');
    expect(compose).toContain('POSTGRES_PASSWORD_FILE: /run/sakura-secrets/postgres-password');
    expect(compose).toContain('runtime-secrets:/run/sakura-secrets:ro');
    expect(compose).toContain('ghcr.io/guyao146/sakura-mcp-server:0.2.4');
    expect(compose).not.toContain('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?');
    expect(compose).not.toMatch(/(?<!\$)\$(?:value|1)\b/);
  });

  it('indexes security audit actions and request correlation', async () => {
    const sql = await readFile(new URL('../migrations/007_audit_security.sql', import.meta.url), 'utf8');
    expect(sql).toContain('auth_source text');
    expect(sql).toContain('request_id uuid');
    expect(sql).toContain('audit_logs_action_created_idx');
  });
});