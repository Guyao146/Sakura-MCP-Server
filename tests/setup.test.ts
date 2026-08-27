import { describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { ConfigCipher } from '../src/settings/crypto.js';
import { SetupService } from '../src/setup/service.js';
import { loadConfig } from '../src/config.js';
import { setupPage, setupScript } from '../src/setup/page.js';

const key = Buffer.alloc(32, 7).toString('base64url');
const config = loadConfig({
  PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: 'postgresql://localhost/test',
  SETUP_TOKEN: 't'.repeat(32), CONFIG_ENCRYPTION_KEY: key,
  MCP_API_KEYS: 'bootstrap:secret:admin:system'
});

describe('installation security', () => {
  it('encrypts configuration with authenticated AES-256-GCM', () => {
    const cipher = new ConfigCipher(key);
    const envelope = cipher.encrypt({ apiKey: 'never-plaintext' });
    expect(JSON.stringify(envelope)).not.toContain('never-plaintext');
    expect(cipher.decrypt(envelope)).toEqual({ apiKey: 'never-plaintext' });
  });

  it('rejects decryption with a different configuration key', () => {
    const envelope = new ConfigCipher(key).encrypt({ secret: true });
    expect(() => new ConfigCipher(Buffer.alloc(32, 8).toString('base64url')).decrypt(envelope)).toThrow();
  });

  it('accepts only the exact setup token', () => {
    const service = new SetupService(config, {} as never, {} as never);
    expect(service.verifyToken('t'.repeat(32))).toBe(true);
    expect(service.verifyToken('x'.repeat(32))).toBe(false);
    expect(service.verifyToken('short')).toBe(false);
  });

  it('loads a CSP-compatible setup script with event listeners', () => {
    expect(setupPage).toContain('<script src="/assets/setup.js" defer></script>');
    expect(setupPage).not.toMatch(/\son(?:click|change)=/);
    expect(setupScript).toContain("$('diagnoseButton').addEventListener('click',diagnose)");
    expect(setupScript).toContain("'HTTP '+response.status");
    expect(() => new Script(setupScript)).not.toThrow();
  });
});