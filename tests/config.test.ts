import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  PUBLIC_BASE_URL: 'https://mcp.example.com',
  DATABASE_URL: 'postgresql://sakura:test@localhost:5432/sakura_memory',
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
  MCP_API_KEYS: 'agent:very-secret:memory:read|memory:write'
};

describe('loadConfig', () => {
  it('parses API key scopes and normalizes public URL', () => {
    const config = loadConfig({ ...base, PUBLIC_BASE_URL: 'https://mcp.example.com/' });
    expect(config.publicBaseUrl).toBe('https://mcp.example.com');
    expect(config.apiKeys[0]).toMatchObject({ id: 'agent', scopes: ['memory:read', 'memory:write'] });
  });
  it('rejects incomplete Authentik configuration', () => {
    expect(() => loadConfig({ ...base, AUTHENTIK_ISSUER: 'https://login.example.com/app' })).toThrow('must be configured together');
  });
  it('parses OpenAI-compatible and Ollama providers independently', () => {
    const config = loadConfig({ ...base, OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com/v1', OLLAMA_BASE_URL: 'http://localhost:11434' });
    expect(config.openaiCompatible?.baseUrl).toBe('https://api.example.com/v1');
    expect(config.ollama?.baseUrl).toBe('http://localhost:11434');
  });

  it('uses a stable PostgreSQL host for panel-managed Compose', () => {
    const config = loadConfig({ ...base });
    expect(config.database.host).toBe('postgres');
  });

  it('does not require a setup token for first-run configuration', () => {
    expect(() => loadConfig({ ...base })).not.toThrow();
    expect(loadConfig({ ...base }).setup).toEqual({ encryptionKey: base.CONFIG_ENCRYPTION_KEY });
  });

  it('enables authentication by default and accepts either AUTH=false spelling', () => {
    expect(loadConfig({ ...base }).authEnabled).toBe(true);
    expect(loadConfig({ ...base, AUTH: 'false' }).authEnabled).toBe(false);
    expect(loadConfig({ ...base, auth: 'false' }).authEnabled).toBe(false);
    expect(loadConfig({ ...base, AUTH: 'true', auth: 'false' }).authEnabled).toBe(false);
  });

  it('ignores incomplete Authentik variables when authentication is disabled', () => {
    const config = loadConfig({ ...base, auth: 'false', AUTHENTIK_ISSUER: 'https://login.example.com/app' });
    expect(config.authEnabled).toBe(false);
    expect(config.authentik).toBeUndefined();
  });
});