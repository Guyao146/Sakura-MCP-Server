import { describe, expect, it } from 'vitest';
import { AuthService, requireScopes } from '../src/auth.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({
  PUBLIC_BASE_URL: 'https://mcp.example.com',
  DATABASE_URL: 'postgresql://sakura:test@localhost:5432/sakura_memory',
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
  MCP_API_KEYS: 'trusted:correct-secret:memory:read|memory:write'
});

describe('AuthService API keys', () => {
  it('authenticates a configured API key', async () => {
    const principal = await new AuthService(config).authenticate('Bearer correct-secret');
    expect(principal).toMatchObject({ id: 'trusted', source: 'api_key', scopes: ['memory:read', 'memory:write'] });
  });
  it('rejects an invalid credential', async () => {
    await expect(new AuthService(config).authenticate('Bearer wrong-secret')).rejects.toThrow('Invalid credential');
  });
  it('enforces tool scopes', async () => {
    const principal = await new AuthService(config).authenticate('Bearer correct-secret');
    expect(() => requireScopes(principal, ['memory:delete'])).toThrow('Missing required scope');
  });
});