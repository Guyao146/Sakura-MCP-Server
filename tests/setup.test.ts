import { describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { ConfigCipher } from '../src/settings/crypto.js';
import { setupPage, setupScript } from '../src/setup/page.js';
import { SetupService } from '../src/setup/service.js';

const key = Buffer.alloc(32, 7).toString('base64url');

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

  it('loads a token-free CSP-compatible setup script and checks automatically', () => {
    expect(setupPage).toContain('<script src="/assets/setup.js" defer></script>');
    expect(setupPage).not.toMatch(/\son(?:click|change)=/);
    expect(setupPage).not.toContain('setupToken');
    expect(setupScript).not.toContain('X-Setup-Token');
    expect(setupScript).toContain("headers:body?{'Content-Type':'application/json'}:undefined");
    expect(setupScript).toContain('raw.slice(0,500)');
    expect(setupScript).toContain("$('diagnoseButton').addEventListener('click',diagnose)");
    expect(setupScript).toContain('else{void diagnose()}');
    expect(setupScript).toContain('go(authEnabled?1:2)');
    expect(setupScript).toContain("const auth=authEnabled?");
    expect(setupScript).toContain('go(authEnabled?1:0)');
    expect(setupPage).toContain('AUTH=false');
    expect(setupScript).toContain("'HTTP '+response.status");
    expect(() => new Script(setupScript)).not.toThrow();
  });

  it('requires Authentik only when authentication is enabled', async () => {
    const settings = { complete: async () => undefined };
    await expect(new SetupService(true, {} as never, settings as never).complete({})).rejects.toThrow('AUTH=true');
    await expect(new SetupService(false, {} as never, settings as never).complete({})).resolves.toBeUndefined();
  });

  it('removes Authentik fields before completing no-auth setup', async () => {
    let saved: unknown;
    const settings = { complete: async (input: unknown) => { saved = input; } };
    const service = new SetupService(false, {} as never, settings as never);
    await service.complete({
      administratorEmail: 'ignored@example.com',
      authentik: {
        issuer: 'https://login.example.com', audience: 'mcp', jwksUri: 'https://login.example.com/jwks',
        scopeClaim: 'scope', clientId: 'ignored', authorizationUrl: 'https://login.example.com/authorize',
        tokenUrl: 'https://login.example.com/token'
      },
      ollama: { baseUrl: 'http://ollama:11434' }
    });
    expect(saved).toEqual({ openaiCompatible: undefined, ollama: { baseUrl: 'http://ollama:11434' } });
  });
});