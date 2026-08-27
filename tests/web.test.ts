import { describe, expect, it, vi } from 'vitest';
import { Script } from 'node:vm';
import { loadConfig } from '../src/config.js';
import { adminPage } from '../src/web/admin-page.js';
import { WebSessionService, type WebIdentity } from '../src/web/session.js';

const config = loadConfig({
  PUBLIC_BASE_URL: 'https://mcp.example.com', DATABASE_URL: 'postgresql://localhost/test',
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 15).toString('base64url'), MCP_API_KEYS: ''
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
    for (const marker of ['记忆空间', '记忆管理', '冲突确认', '后台任务', '审计日志', 'Agent 密钥', '模型 Provider', 'AI 策略', '导入', '导出 JSON', 'inviteMember', 'grantAgent', 'saveStrategy', 'saveProvider', 'resolveConflict', 'importMemories', 'startRebuild', 'loadAudit']) {
      expect(adminPage).toContain(marker);
    }
  });

  it('shows the running version and update controls', () => {
    for (const marker of ['当前版本', '版本更新', '检查更新', '/api/admin/version', 'headerVersion']) {
      expect(adminPage).toContain(marker);
    }
  });

  it('only declares JSON content for requests that have a body', () => {
    expect(adminPage).toContain("if(opt.body!==undefined)headers['Content-Type']='application/json'");
    expect(adminPage).toContain('raw.slice(0,500)');
  });

  it('shows an explicit warning and hides logout in no-auth mode', () => {
    expect(adminPage).toContain('AUTH=false：身份验证已关闭');
    expect(adminPage).toContain("$('authWarning').style.display=d.authEnabled?'none':'block'");
    expect(adminPage).toContain("$('logoutButton').style.display=d.authEnabled?'inline-block':'none'");
  });

  it('creates and caches a stable local system administrator identity', async () => {
    const client = { release: vi.fn(), query: vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ id: '20000000-0000-4000-8000-000000000002' }] })
      .mockResolvedValueOnce({ rows: [{ id: '30000000-0000-4000-8000-000000000003' }] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({}) };
    const database = { pool: { connect: vi.fn().mockResolvedValue(client) }, query: vi.fn().mockResolvedValue({}) };
    const disabled = loadConfig({ ...config as never, PUBLIC_BASE_URL: config.publicBaseUrl,
      DATABASE_URL: config.database.connectionString, CONFIG_ENCRYPTION_KEY: config.setup.encryptionKey,
      MCP_API_KEYS: '', AUTH: 'false' } as never);
    const service = new WebSessionService(database as never, () => disabled);
    const first = await service.localIdentity();
    const second = await service.localIdentity();
    expect(first).toMatchObject({ subject: 'local-admin', displayName: 'Local Administrator', isSystemAdmin: true });
    expect(second).toBe(first);
    expect(database.pool.connect).toHaveBeenCalledTimes(1);
    expect(database.query).toHaveBeenCalledWith('UPDATE users SET is_system_admin=true WHERE id=$1', [first.userId]);
  });

  it('contains syntactically valid browser JavaScript', () => {
    const script = adminPage.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
  });
});