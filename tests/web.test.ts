import { describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { loadConfig } from '../src/config.js';
import { adminPage } from '../src/web/admin-page.js';
import { WebSessionService, type WebIdentity } from '../src/web/session.js';

const config = loadConfig({
  PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: 'postgresql://localhost/test',
  SETUP_TOKEN: 'a'.repeat(32), CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 15).toString('base64url'), MCP_API_KEYS: ''
});
const identity: WebIdentity = {
  sessionId: '10000000-0000-4000-8000-000000000001', userId: '20000000-0000-4000-8000-000000000002',
  subject: 'subject', email: 'user@example.com', displayName: 'User', avatarUrl: null, isSystemAdmin: false,
  expiresAt: new Date(Date.now() + 3600000).toISOString()
};

describe('Web management security', () => {
  it('binds CSRF tokens to the Web session and server key', () => {
    const service = new WebSessionService({} as never, () => config);
    const token = service.csrf(identity);
    expect(service.verifyCsrf(identity, token)).toBe(true);
    expect(service.verifyCsrf({ ...identity, sessionId: '30000000-0000-4000-8000-000000000003' }, token)).toBe(false);
    expect(service.verifyCsrf(identity, 'invalid')).toBe(false);
  });

  it('uses textContent for server data and does not template user identity into HTML', () => {
    expect(adminPage).toContain('textContent=x.summary');
    expect(adminPage).toContain("textContent=d.me.displayName");
    expect(adminPage).not.toContain('${identity.');
  });

  it('includes management views for spaces, memories, Agents and members', () => {
    for (const marker of ['记忆空间', '记忆管理', 'Agent 密钥', 'inviteMember', 'grantAgent']) {
      expect(adminPage).toContain(marker);
    }
  });

  it('contains syntactically valid browser JavaScript', () => {
    const script = adminPage.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
  });
});