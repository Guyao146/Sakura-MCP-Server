import { describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { ConfigCipher } from '../src/settings/crypto.js';
import { setupPage, setupScript } from '../src/setup/page.js';

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
    expect(setupScript).toContain("'HTTP '+response.status");
    expect(() => new Script(setupScript)).not.toThrow();
  });
});