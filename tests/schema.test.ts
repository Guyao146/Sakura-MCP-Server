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
    expect(compose).toMatch(/ghcr\.io\/guyao146\/sakura-mcp-server:0\.2\.\d+/);
    expect(compose).toContain('127.0.0.1:${MCP_HOST_PORT:-3001}:3000');
    expect(compose).toContain('AUTH: ${AUTH:-}');
    expect(compose).toContain('auth: ${auth:-}');
    expect(compose).not.toContain('SETUP_TOKEN');
    expect(compose).not.toContain('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?');
    expect(compose).not.toMatch(/(?<!\$)\$(?:value|1)\b/);
  });

  it('proxies every token-free setup resource with the public host', async () => {
    const nginx = await readFile(new URL('../nginx-mcp.conf.example', import.meta.url), 'utf8');
    expect(nginx).toContain('proxy_set_header Host $host;');
    expect(nginx).not.toContain('X-Setup-Token');
    expect(nginx).toContain('location = / {');
    expect(nginx).toContain('location = /assets/setup.js');
    expect(nginx).toContain('location ^~ /api/setup/');
    expect(nginx).toContain('proxy_pass http://127.0.0.1:3001;');
    expect(nginx).toMatch(/location = \/ \{[\s\S]*?proxy_read_timeout 120s;[\s\S]*?proxy_buffering off;/);
    expect(nginx).toContain('location = /.well-known/oauth-protected-resource {');
  });

  it('keeps management APIs unavailable until installation completes', async () => {
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(source).toContain("app.use('/api/admin/*', async (context, next)");
    expect(source).toContain("error: 'setup_required'");
  });

  it('serves MCP on the root domain while retaining the legacy path', async () => {
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(source).toContain("app.all('/', async context => isRootMcpRequest");
    expect(source).toContain("app.all('/mcp', handleMcp)");
    expect(source).toContain('resource: config.publicBaseUrl');
    expect(source).toContain('resource: `${config.publicBaseUrl}/mcp`');
  });

  it('exposes system-admin Authentik recovery endpoints', async () => {
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(source).toContain("app.get('/api/admin/authentik'");
    expect(source).toContain("app.put('/api/admin/authentik'");
    expect(source).toContain('await setup.testAuthentik(body.authentik)');
    expect(source).toContain('await settings.saveAuthentik(body.authentik, body.administratorEmail)');
    expect(source).toContain('restartRequired: !baseConfig.authEnabled');
    expect(source).toContain("'Authentik 配置已保存。请将 AUTH 恢复为 true 并重启应用。'");
  });

  it('supports a dedicated embedding provider endpoint', async () => {
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(source).toContain("z.enum(['openai_compatible', 'ollama', 'embedding'])");
    expect(source).toContain("await settings.saveProvider('embedding'");
  });

  it('indexes security audit actions and request correlation', async () => {
    const sql = await readFile(new URL('../migrations/007_audit_security.sql', import.meta.url), 'utf8');
    expect(sql).toContain('auth_source text');
    expect(sql).toContain('request_id uuid');
    expect(sql).toContain('audit_logs_action_created_idx');
  });
});