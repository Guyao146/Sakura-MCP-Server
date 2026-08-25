import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { PUBLIC_BASE_URL: 'https://mcp.example.com', MCP_API_KEYS: 'agent:very-secret:life:read|home:read' };

describe('loadConfig', () => {
  it('parses API key scopes and normalizes public URL', () => {
    const config = loadConfig({ ...base, PUBLIC_BASE_URL: 'https://mcp.example.com/' });
    expect(config.publicBaseUrl).toBe('https://mcp.example.com');
    expect(config.apiKeys[0]).toMatchObject({ id: 'agent', scopes: ['life:read', 'home:read'] });
  });
  it('rejects incomplete Authentik configuration', () => {
    expect(() => loadConfig({ ...base, AUTHENTIK_ISSUER: 'https://login.example.com/app' })).toThrow('must be configured together');
  });
  it('rejects a partial Home Assistant configuration', () => {
    expect(() => loadConfig({ ...base, HOME_ASSISTANT_URL: 'https://home.example.com' })).toThrow('must be configured together');
  });
});