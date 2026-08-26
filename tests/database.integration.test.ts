import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Database } from '../src/database.js';
import { MemoryRepository } from '../src/memory/repository.js';
import { SettingsRepository } from '../src/settings/repository.js';
import { AgentRepository } from '../src/agents/repository.js';
import { AuthService } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { requireAgentSpaceScope } from '../src/memory/permissions.js';
import { SpaceRepository } from '../src/spaces/repository.js';
import { WebSessionService } from '../src/web/session.js';
import { SemanticMemoryService } from '../src/semantic/service.js';
import { MemoryGovernanceService } from '../src/governance/service.js';
import { MemoryTransferService } from '../src/transfer/service.js';
import { JobRepository } from '../src/jobs/repository.js';
import { BackgroundWorker } from '../src/jobs/worker.js';

const connectionString = process.env.DATABASE_TEST_URL;
const describeDatabase = connectionString ? describe : describe.skip;
const encryptionKey = Buffer.alloc(32, 13).toString('base64url');

describeDatabase('PostgreSQL installation integration', () => {
  const database = new Database(connectionString!, 4);
  const settings = new SettingsRepository(database, encryptionKey);

  beforeAll(async () => { await database.migrate(); }, 30_000);
  afterAll(async () => { await database.close(); });
  afterEach(() => vi.unstubAllGlobals());

  it('applies pgvector and every ordered migration', async () => {
    const extension = await database.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname='vector'");
    const migrations = await database.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(extension.rows[0].extversion).toBeTruthy();
    expect(migrations.rows.map(row => row.name)).toEqual(['001_memory_platform.sql', '002_installation.sql', '003_web_sessions.sql', '004_semantic_memory.sql', '005_memory_governance.sql', '006_background_jobs.sql']);
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

  it('embeds memories and performs pgvector hybrid recall', async () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: connectionString!, SETUP_TOKEN: 'v'.repeat(32),
      CONFIG_ENCRYPTION_KEY: encryptionKey, MCP_API_KEYS: '', OLLAMA_BASE_URL: 'http://ollama.test',
      OLLAMA_CHAT_MODEL: 'chat-test', OLLAMA_EMBEDDING_MODEL: 'embed-test'
    });
    const repository = new MemoryRepository(database);
    const identity = await repository.ensureUser('semantic-owner', { email: 'semantic@example.com', displayName: 'Semantic Owner' });
    const semantic = new SemanticMemoryService(database, () => config);
    await semantic.configureStrategy(identity.userId, identity.personalSpaceId, {
      providerType: 'ollama', chatModel: 'chat-test', embeddingModel: 'embed-test', autoExtractEnabled: false,
      autoMergeEnabled: false, conflictDetectionEnabled: true, privacyMode: true
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ embeddings: [[1, 0, 0]] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })));
    const stored = await semantic.remember(identity.userId, {
      spaceId: identity.personalSpaceId, type: 'preference', content: 'User prefers sakura tea', summary: 'Tea preference', tags: ['tea']
    });
    expect(stored.embeddingStatus).toBe('ready');
    const embedding = await database.query<{ status: string; dimensions: number; vector: string }>(
      'SELECT status,dimensions,embedding::text AS vector FROM memory_embeddings WHERE memory_id=$1', [stored.id]);
    expect(embedding.rows[0]).toMatchObject({ status: 'ready', dimensions: 3, vector: '[1,0,0]' });
    const recalled = await semantic.hybridSearch(identity.userId, identity.personalSpaceId, 'favorite drink', 10);
    expect(recalled.map(item => item.id)).toContain(stored.id);
    await expect(semantic.configureStrategy(identity.userId, identity.personalSpaceId, {
      providerType: 'openai_compatible', autoExtractEnabled: false, autoMergeEnabled: false,
      conflictDetectionEnabled: true, privacyMode: true
    })).rejects.toThrow('Privacy mode only permits');
  });

  it('keeps raw memory when embedding fails', async () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: connectionString!, SETUP_TOKEN: 'f'.repeat(32),
      CONFIG_ENCRYPTION_KEY: encryptionKey, MCP_API_KEYS: '', OLLAMA_BASE_URL: 'http://ollama.failure',
      OLLAMA_EMBEDDING_MODEL: 'broken-model'
    });
    const repository = new MemoryRepository(database);
    const identity = await repository.ensureUser('embedding-failure-owner', { displayName: 'Failure Owner' });
    const semantic = new SemanticMemoryService(database, () => config);
    await semantic.configureStrategy(identity.userId, identity.personalSpaceId, {
      providerType: 'ollama', embeddingModel: 'broken-model', autoExtractEnabled: false,
      autoMergeEnabled: false, conflictDetectionEnabled: true, privacyMode: true
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Ollama unavailable')));
    const stored = await semantic.remember(identity.userId, {
      spaceId: identity.personalSpaceId, type: 'fact', content: 'This raw memory must survive'
    });
    expect(stored.embeddingStatus).toBe('failed');
    await expect(repository.get(identity.userId, stored.id)).resolves.toMatchObject({ content: 'This raw memory must survive' });
    const status = await database.query<{ status: string; embedding: string | null }>('SELECT status,embedding::text FROM memory_embeddings WHERE memory_id=$1', [stored.id]);
    expect(status.rows[0]).toMatchObject({ status: 'failed', embedding: null });
  });

  it('detects duplicates, stores feedback, links memories and resolves conflicts', async () => {
    const repository = new MemoryRepository(database);
    const identity = await repository.ensureUser('governance-owner', { email: 'governance@example.com', displayName: 'Governance Owner' });
    const first = await repository.remember(identity.userId, {
      spaceId: identity.personalSpaceId, type: 'fact', content: 'The preferred editor is VS Code', summary: 'Editor preference'
    });
    const duplicate = await repository.remember(identity.userId, {
      spaceId: identity.personalSpaceId, type: 'fact', content: '  the   preferred editor is VS Code  ', summary: 'Same editor preference'
    });
    const governance = new MemoryGovernanceService(database);
    const detection = await governance.detect(identity.userId, duplicate.id);
    expect(detection.duplicateOf).toBe(first.id);
    const relation = await database.query<{ relation_type: string }>(
      'SELECT relation_type FROM memory_relations WHERE from_memory_id=$1 AND to_memory_id=$2', [duplicate.id, first.id]);
    expect(relation.rows[0].relation_type).toBe('duplicate_of');
    await expect(governance.feedback(identity.userId, first.id, true, 'Confirmed')).resolves.toMatchObject({ helpful: true });
    const feedback = await database.query<{ helpful: boolean; correction: string }>('SELECT helpful,correction FROM memory_feedback WHERE memory_id=$1 AND user_id=$2', [first.id, identity.userId]);
    expect(feedback.rows[0]).toMatchObject({ helpful: true, correction: 'Confirmed' });

    const conflict = await database.query<{ id: string }>(
      `INSERT INTO memory_conflicts(space_id,memory_a_id,memory_b_id,reason) VALUES($1,$2,$3,'Integration conflict') RETURNING id`,
      [identity.personalSpaceId, first.id, duplicate.id]);
    await expect(governance.resolve(identity.userId, conflict.rows[0].id, 'keep_a')).resolves.toMatchObject({ status: 'resolved' });
    const states = await database.query<{ id: string; status: string; supersedes_id: string | null }>('SELECT id,status,supersedes_id FROM memories WHERE id=ANY($1)', [[first.id, duplicate.id]]);
    const winner = states.rows.find(row => row.id === first.id)!;
    const loser = states.rows.find(row => row.id === duplicate.id)!;
    expect(winner.supersedes_id).toBe(duplicate.id);
    expect(loser.status).toBe('superseded');
    await expect(governance.link(identity.userId, first.id, first.id, 'self', 1)).rejects.toThrow('cannot relate to itself');
  });

  it('round-trips portable JSON and Markdown with tracked partial failures', async () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: connectionString!, SETUP_TOKEN: 'i'.repeat(32),
      CONFIG_ENCRYPTION_KEY: encryptionKey, MCP_API_KEYS: ''
    });
    const repository = new MemoryRepository(database);
    const identity = await repository.ensureUser('transfer-owner', { email: 'transfer@example.com', displayName: 'Transfer Owner' });
    const spaces = new SpaceRepository(database);
    const source = await spaces.create(identity.userId, 'Transfer Source', 'portable source');
    const jsonTarget = await spaces.create(identity.userId, 'JSON Target', 'portable target');
    const markdownTarget = await spaces.create(identity.userId, 'Markdown Target', 'portable target');
    await repository.remember(identity.userId, { spaceId: source.id, type: 'fact', content: 'Portable fact one', summary: 'First portable memory', tags: ['portable'] });
    await repository.remember(identity.userId, { spaceId: source.id, type: 'preference', content: 'Portable preference two', summary: 'Second portable memory' });
    const semantic = new SemanticMemoryService(database, () => config);
    const transfer = new MemoryTransferService(database, semantic, new MemoryGovernanceService(database));
    const json = await transfer.export(identity.userId, source.id, 'json');
    expect(json.content).toContain('sakura-memory-export/v1');
    expect(json.content).not.toContain('provider-secret');
    const jsonImport = await transfer.import(identity.userId, jsonTarget.id, 'json', json.content, 'integration-test');
    expect(jsonImport).toMatchObject({ status: 'completed', completed: 2, failed: 0 });
    const markdown = await transfer.export(identity.userId, source.id, 'markdown');
    expect(markdown.content).toContain('## First portable memory');
    const markdownImport = await transfer.import(identity.userId, markdownTarget.id, 'markdown', markdown.content);
    expect(markdownImport.completed).toBe(2);
    const partial = await transfer.import(identity.userId, jsonTarget.id, 'json', JSON.stringify([
      { type: 'fact', content: 'Valid partial import' }, { type: 'invalid', content: '' }
    ]));
    expect(partial).toMatchObject({ status: 'completed', completed: 1, failed: 1 });
    await expect(transfer.status(identity.userId, partial.jobId)).resolves.toMatchObject({ status: 'completed' });
  });

  it('claims jobs once and rebuilds embeddings through the persistent worker', async () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: connectionString!, SETUP_TOKEN: 'q'.repeat(32),
      CONFIG_ENCRYPTION_KEY: encryptionKey, MCP_API_KEYS: '', OLLAMA_BASE_URL: 'http://worker-ollama.test',
      OLLAMA_EMBEDDING_MODEL: 'worker-embed'
    });
    const repository = new MemoryRepository(database);
    const identity = await repository.ensureUser('worker-owner', { email: 'worker@example.com', displayName: 'Worker Owner' });
    await repository.remember(identity.userId, { spaceId: identity.personalSpaceId, type: 'fact', content: 'Worker rebuild memory one' });
    await repository.remember(identity.userId, { spaceId: identity.personalSpaceId, type: 'fact', content: 'Worker rebuild memory two' });
    const semantic = new SemanticMemoryService(database, () => config);
    await semantic.configureStrategy(identity.userId, identity.personalSpaceId, {
      providerType: 'ollama', embeddingModel: 'worker-embed', autoExtractEnabled: false,
      autoMergeEnabled: false, conflictDetectionEnabled: true, privacyMode: true
    });
    const jobs = new JobRepository(database);
    const queued = await jobs.enqueue(identity.userId, identity.personalSpaceId, 'rebuild_embeddings');
    const claimed = await Promise.all([jobs.claim('claimer-a', 900), jobs.claim('claimer-b', 900)]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    await database.query(`UPDATE ingestion_jobs SET status='pending',attempts=0,locked_at=NULL,locked_by=NULL WHERE id=$1`, [queued.id]);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ embeddings: [[0, 1, 0]] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })));
    const log = { info: vi.fn(), error: vi.fn() };
    const worker = new BackgroundWorker(database, semantic, 1000, 900, log);
    await expect(worker.runOnce()).resolves.toBe(true);
    const finished = await jobs.get(identity.userId, queued.id);
    expect(finished).toMatchObject({ status: 'completed' });
    expect((finished.progress as { completed: number }).completed).toBe(2);
    const embeddings = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory_embeddings me JOIN memories m ON m.id=me.memory_id
       WHERE m.space_id=$1 AND me.status='ready'`, [identity.personalSpaceId]);
    expect(Number(embeddings.rows[0].count)).toBe(2);
  });

  it('cancels pending jobs and permits an explicit retry', async () => {
    const repository = new MemoryRepository(database);
    const identity = await repository.ensureUser('job-cancel-owner', { displayName: 'Job Cancel Owner' });
    const jobs = new JobRepository(database);
    const queued = await jobs.enqueue(identity.userId, identity.personalSpaceId, 'rebuild_embeddings');
    await expect(jobs.cancel(identity.userId, queued.id)).resolves.toMatchObject({ status: 'cancelled', cancel_requested: true });
    await expect(jobs.retry(identity.userId, queued.id)).resolves.toMatchObject({ status: 'pending', cancel_requested: false });
  });
});