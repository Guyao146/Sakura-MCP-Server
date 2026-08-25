import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  PUBLIC_BASE_URL: 'https://mcp.example.com',
  DATABASE_URL: 'postgresql://sakura:test@localhost:5432/sakura_memory',
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
});