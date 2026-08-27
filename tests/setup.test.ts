import { afterEach, describe, expect, it, vi } from 'vitest';
import { Script } from 'node:vm';
import { ConfigCipher } from '../src/settings/crypto.js';
import { setupPage, setupScript } from '../src/setup/page.js';
import { SetupService } from '../src/setup/service.js';

const key = Buffer.alloc(32, 7).toString('base64url');
afterEach(() => vi.unstubAllGlobals());

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
    expect(setupPage).toContain('authApplicationSlug');
    expect(setupPage).toContain('获取 OpenID 配置');
    expect(setupScript).toContain("api('discover-authentik',{baseUrl,applicationSlug})");
    expect(setupScript).toContain('setTimeout(()=>void discoverAuthentik(false),600)');
    expect(setupScript).toContain('requestId!==discoveryRequestId');
    for (const field of ['issuer','jwksUri','authorizationUrl','tokenUrl','userinfoUrl']) {
      expect(setupScript).toContain(`$('${field}').value=data.${field}`);
    }
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

  it('discovers and validates Authentik OpenID configuration', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      issuer: 'https://login.example.com/application/o/sakura-mcp/',
      authorization_endpoint: 'https://login.example.com/application/o/authorize/',
      token_endpoint: 'https://login.example.com/application/o/token/',
      jwks_uri: 'https://login.example.com/application/o/sakura-mcp/jwks/',
      userinfo_endpoint: 'https://login.example.com/application/o/userinfo/'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    const service = new SetupService(true, {} as never, {} as never);
    await expect(service.discoverAuthentik({ baseUrl: 'https://login.example.com', applicationSlug: 'sakura-mcp' }))
      .resolves.toMatchObject({
        issuer: 'https://login.example.com/application/o/sakura-mcp/',
        jwksUri: 'https://login.example.com/application/o/sakura-mcp/jwks/',
        authorizationUrl: 'https://login.example.com/application/o/authorize/',
        tokenUrl: 'https://login.example.com/application/o/token/',
        userinfoUrl: 'https://login.example.com/application/o/userinfo/'
      });
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://login.example.com/application/o/sakura-mcp/.well-known/openid-configuration'),
      expect.objectContaining({ redirect: 'error', headers: { Accept: 'application/json' } })
    );
  });

  it('rejects unsafe, cross-origin, and disabled Authentik discovery', async () => {
    const enabled = new SetupService(true, {} as never, {} as never);
    await expect(enabled.discoverAuthentik({ baseUrl: 'http://login.example.com', applicationSlug: 'sakura' }))
      .rejects.toThrow('HTTPS origin');
    await expect(enabled.discoverAuthentik({ baseUrl: 'https://login.example.com/path', applicationSlug: 'sakura' }))
      .rejects.toThrow('HTTPS origin');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      issuer: 'https://evil.example.com/application/o/sakura/',
      authorization_endpoint: 'https://login.example.com/application/o/authorize/',
      token_endpoint: 'https://login.example.com/application/o/token/',
      jwks_uri: 'https://login.example.com/application/o/sakura/jwks/'
    }), { status: 200 })));
    await expect(enabled.discoverAuthentik({ baseUrl: 'https://login.example.com', applicationSlug: 'sakura' }))
      .rejects.toThrow('cross-origin');
    await expect(new SetupService(false, {} as never, {} as never)
      .discoverAuthentik({ baseUrl: 'https://login.example.com', applicationSlug: 'sakura' }))
      .rejects.toThrow('AUTH=false');
  });

  it('rejects malformed, failed, and oversized discovery responses', async () => {
    const service = new SetupService(true, {} as never, {} as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream error', { status: 502 })));
    await expect(service.discoverAuthentik({ baseUrl: 'https://login.example.com', applicationSlug: 'sakura' }))
      .rejects.toThrow('(502)');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
    await expect(service.discoverAuthentik({ baseUrl: 'https://login.example.com', applicationSlug: 'sakura' }))
      .rejects.toThrow('not valid JSON');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(service.discoverAuthentik({ baseUrl: 'https://login.example.com', applicationSlug: 'sakura' }))
      .rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', {
      status: 200, headers: { 'Content-Length': '1000001' }
    })));
    await expect(service.discoverAuthentik({ baseUrl: 'https://login.example.com', applicationSlug: 'sakura' }))
      .rejects.toThrow('too large');
    await expect(service.discoverAuthentik({ baseUrl: 'https://login.example.com', applicationSlug: '../admin' }))
      .rejects.toThrow('slug');
  });
});