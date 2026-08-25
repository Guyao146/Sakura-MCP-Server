import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/database.js';
import { MemoryRepository } from '../src/memory/repository.js';
import { SettingsRepository } from '../src/settings/repository.js';
import { AgentRepository } from '../src/agents/repository.js';
import { AuthService } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { requireAgentSpaceScope } from '../src/memory/permissions.js';
import { SpaceRepository } from '../src/spaces/repository.js';
import { WebSessionService } from '../src/web/session.js';

const connectionString = process.env.DATABASE_TEST_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const encryptionKey = Buffer.alloc(32, 13).toString('base64url');

describeDatabase('PostgreSQL installation integration', () => {
  const database = new Database(connectionString!, 4);
  const settings = new SettingsRepository(database, encryptionKey);

  beforeAll(async () => { await database.migrate(); }, 30_000);
  afterAll(async () => { await database.close(); });

  it('applies pgvector and every ordered migration', async () => {
    const extension = await database.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname='vector'");
    const migrations = await database.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(extension.rows[0].extversion).toBeTruthy();
    expect(migrations.rows.map(row => row.name)).toEqual(['001_memory_platform.sql', '002_installation.sql', '003_web_sessions.sql']);
    await expect(settings.installation()).resolves.toMatchObject({ completed: false });
  });

  it('completes installation once and encrypts provider credentials', async () => {
    await settings.complete({
      administratorEmail: 'owner@example.com',
      authentik: {
        issuer: 'https://login.example.com/application/o/sakura-mcp/', audience: 'https://mcp.example.com',
        jwksUri: 'https://login.example.com/jwks/', scopeClaim: 'scope', clientId: 'sakura-web',
        authorizationUrl: 'https://login.example.com/application/o/authorize/', tokenUrl: 'https://login.example.com/application/o/token/'
      },
      openaiCompatible: { baseUrl: 'https://api.example.com/v1', apiKey: 'provider-secret', chatModel: 'chat', embeddingModel: 'embed' },
      ollama: { baseUrl: 'http://ollama:11434', chatModel: 'local-chat', embeddingModel: 'local-embed' }
    });
    await expect(settings.installation()).resolves.toMatchObject({ completed: true, administrator_email: 'owner@example.com' });
    await expect(settings.get<{ apiKey: string }>('provider.openai_compatible')).resolves.toMatchObject({ apiKey: 'provider-secret' });
    const raw = await database.query<{ value: unknown }>("SELECT value FROM system_settings WHERE key='provider.openai_compatible'");
    expect(JSON.stringify(raw.rows[0].value)).not.toContain('provider-secret');
    await expect(settings.complete({ administratorEmail: 'other@example.com', authentik: { issuer: 'https://login.example.com', audience: 'mcp', jwksUri: 'https://login.example.com/jwks', scopeClaim: 'scope' } })).rejects.toThrow('already installed');
  });

  it('promotes the allowlisted Authentik email on first login', async () => {
    const identity = await new MemoryRepository(database).ensureUser('authentik-subject-owner', { email: 'OWNER@example.com', displayName: 'Owner' });
    const user = await database.query<{ is_system_admin: boolean }>('SELECT is_system_admin FROM users WHERE id=$1', [identity.userId]);
    expect(user.rows[0].is_system_admin).toBe(true);
  });

  it('creates hashed Agent keys, enforces space grants, and revokes immediately', async () => {
    const memory = new MemoryRepository(database);
    const identity = await memory.ensureUser('agent-owner-subject', { email: 'agent-owner@example.com', displayName: 'Agent Owner' });
    const spaces = new SpaceRepository(database);
    const shared = await spaces.create(identity.userId, 'Agent Shared Space', 'integration test');
    const hidden = await spaces.create(identity.userId, 'Hidden Space', 'must not be listed');
    const agents = new AgentRepository(database);
    const created = await agents.create(identity.userId, 'Test Agent', ['memory:read', 'memory:write']);
    expect(created.token).toMatch(/^sk_sakura_/);
    const raw = await database.query<{ secret_hash: string }>('SELECT secret_hash FROM agent_credentials WHERE id=$1', [created.id]);
    expect(raw.rows[0].secret_hash).not.toContain(created.token);

    const authConfig = loadConfig({
      PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: connectionString!, SETUP_TOKEN: 'z'.repeat(32),
      CONFIG_ENCRYPTION_KEY: encryptionKey, MCP_API_KEYS: ''
    });
    const principal = await new AuthService(authConfig, database).authenticate(`Bearer ${created.token}`);
    expect(principal).toMatchObject({ id: 'agent-owner-subject', agentId: created.id, scopes: ['memory:read', 'memory:write'] });
    await expect(requireAgentSpaceScope(database, created.id, shared.id, 'memory:read')).rejects.toThrow('not granted');
    await agents.grant(identity.userId, created.id, shared.id, ['memory:read']);
    await expect(requireAgentSpaceScope(database, created.id, shared.id, 'memory:read')).resolves.toBeUndefined();
    await expect(agents.grant(identity.userId, created.id, shared.id, ['memory:delete'])).rejects.toThrow('exceeds Agent global scopes');
    const visible = await spaces.list(identity.userId, created.id);
    expect(visible.map(row => row.id)).toContain(shared.id);
    expect(visible.map(row => row.id)).not.toContain(hidden.id);
    await agents.revoke(identity.userId, created.id);
    await expect(new AuthService(authConfig, database).authenticate(`Bearer ${created.token}`)).rejects.toThrow('Invalid credential');
  });

  it('stores only hashed Web sessions and revokes logout immediately', async () => {
    const identity = await new MemoryRepository(database).ensureUser('web-session-user', { email: 'web@example.com', displayName: 'Web User' });
    const token = `sess_${Buffer.alloc(32, 21).toString('base64url')}`;
    const tokenHash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex');
    await database.query(`INSERT INTO web_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [identity.userId, tokenHash]);
    const service = new WebSessionService(database, () => loadConfig({
      PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: connectionString!, SETUP_TOKEN: 'w'.repeat(32),
      CONFIG_ENCRYPTION_KEY: encryptionKey, MCP_API_KEYS: ''
    }));
    await expect(service.authenticate(token)).resolves.toMatchObject({ userId: identity.userId, email: 'web@example.com' });
    expect(service.cookie(token)).toContain('HttpOnly');
    expect(service.cookie(token)).toContain('SameSite=Lax');
    expect(service.cookie(token)).toContain('Secure');
    const raw = await database.query<{ token_hash: string }>('SELECT token_hash FROM web_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [identity.userId]);
    expect(raw.rows[0].token_hash).not.toContain(token);
    await service.logout(token);
    await expect(service.authenticate(token)).rejects.toThrow('invalid, expired, or revoked');
  });

  it('persists, searches, versions and soft-deletes Web-managed memories', async () => {
    const repository = new MemoryRepository(database);
    const identity = await repository.ensureUser('web-memory-owner', { email: 'memory@example.com', displayName: 'Memory Owner' });
    const created = await repository.remember(identity.userId, {
      spaceId: identity.personalSpaceId, type: 'fact', content: 'Sakura memory integration marker',
      summary: 'Integration marker', tags: ['integration', 'web'], source: { type: 'web_admin' }
    });
    const found = await repository.search(identity.userId, identity.personalSpaceId, 'Sakura memory integration', 10);
    expect(found.map(item => item.id)).toContain(created.id);
    const updated = await repository.update(identity.userId, created.id, { summary: 'Updated integration marker' }, 'Web test update');
    expect(updated.summary).toBe('Updated integration marker');
    const versions = await database.query<{ version: number }>('SELECT version FROM memory_versions WHERE memory_id=$1 ORDER BY version', [created.id]);
    expect(versions.rows.map(row => Number(row.version))).toEqual([1, 2]);
    await repository.forget(identity.userId, created.id, false);
    await expect(repository.get(identity.userId, created.id)).rejects.toThrow('not found or access denied');
  });
});