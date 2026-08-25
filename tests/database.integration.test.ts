import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/database.js';
import { MemoryRepository } from '../src/memory/repository.js';
import { SettingsRepository } from '../src/settings/repository.js';

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
    expect(migrations.rows.map(row => row.name)).toEqual(['001_memory_platform.sql', '002_installation.sql']);
    await expect(settings.installation()).resolves.toMatchObject({ completed: false });
  });

  it('completes installation once and encrypts provider credentials', async () => {
    await settings.complete({
      administratorEmail: 'owner@example.com',
      authentik: { issuer: 'https://login.example.com/application/o/sakura-mcp/', audience: 'https://mcp.example.com', jwksUri: 'https://login.example.com/jwks/', scopeClaim: 'scope' },
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
});