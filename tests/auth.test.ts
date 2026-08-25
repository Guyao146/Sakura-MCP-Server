import { describe, expect, it } from 'vitest';
import { AuthService, requireScopes } from '../src/auth.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({ PUBLIC_BASE_URL: 'https://mcp.example.com', MCP_API_KEYS: 'trusted:correct-secret:life:read|home:read' });

describe('AuthService API keys', () => {
  it('authenticates a configured API key', async () => {
    const principal = await new AuthService(config).authenticate('Bearer correct-secret');
    expect(principal).toMatchObject({ id: 'trusted', source: 'api_key', scopes: ['life:read', 'home:read'] });
  });
  it('rejects an invalid credential', async () => {
    await expect(new AuthService(config).authenticate('Bearer wrong-secret')).rejects.toThrow('Invalid credential');
  });
  it('enforces tool scopes', async () => {
    const principal = await new AuthService(config).authenticate('Bearer correct-secret');
    expect(() => requireScopes(principal, ['home:control'])).toThrow('Missing required scope');
  });
});