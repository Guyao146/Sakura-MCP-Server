import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildText, clampTail, listTasks, messageToText, readMessages } from '../src/cline-store.js';
import { redactSecrets } from '../src/redact.js';
import { normalizeConfig, validateConfig, defaultClineTasksDir } from '../src/config.js';
import { parseSse } from '../src/mcp-client.js';
import { mask } from '../src/gui.js';

async function makeTasksDir(tasks: Record<string, unknown[]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cline-sync-'));
  for (const [taskId, messages] of Object.entries(tasks)) {
    const dir = join(root, taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'api_conversation_history.json'), JSON.stringify(messages), 'utf8');
  }
  return root;
}

const message = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });

describe('Cline task history parsing', () => {
  it('lists only task directories that contain a conversation history', async () => {
    const root = await makeTasksDir({ '1700000000001': [message('user', 'hi')] });
    await mkdir(join(root, 'incomplete'), { recursive: true });
    const tasks = await listTasks(root);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskId).toBe('1700000000001');
    await expect(listTasks(join(root, 'missing'))).resolves.toEqual([]);
  });

  it('flattens text blocks and drops tool results and images', () => {
    expect(messageToText({ role: 'user', content: 'plain' })).toBe('user: plain');
    expect(messageToText(message('assistant', 'answer'))).toBe('assistant: answer');
    expect(messageToText({ role: 'user', content: [{ type: 'image', source: {} }] })).toBe('');
    expect(messageToText({ role: 'user', content: 42 })).toBe('');
  });

  it('rejects malformed history files and skips non-message entries', async () => {
    const root = await makeTasksDir({ '1700000000002': [message('user', 'ok'), null as never, { noRole: true } as never] });
    const parsed = await readMessages(join(root, '1700000000002', 'api_conversation_history.json'));
    expect(parsed).toHaveLength(1);

    const broken = join(root, '1700000000003');
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, 'api_conversation_history.json'), '{not json', 'utf8');
    await expect(readMessages(join(broken, 'api_conversation_history.json'))).rejects.toThrow('不是合法 JSON');
  });

  it('keeps the most recent tail when the text exceeds the server limit', () => {
    const messages = Array.from({ length: 50 }, (_, i) => message('user', `m${i}`.padEnd(100, 'x')));
    const text = buildText(messages, 500);
    expect(text.length).toBe(500);
    expect(text.endsWith('x')).toBe(true);
    expect(clampTail('abcdef', 3)).toBe('def');
    expect(clampTail('ab', 5)).toBe('ab');
  });
});

describe('secret redaction', () => {
  it('masks the credential shapes most likely to leak', () => {
    const input = [
      'token is sk_sakura_8eQyfFJG_U1QRS0abcdefghij',
      'openai sk-abcdefghijklmnopqrstuvwx',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      'GITHUB=ghp_abcdefghijklmnopqrstuvwxyz0123',
      'password: "hunter2secret"',
      'AWS AKIAIOSFODNN7EXAMPLE here',
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----'
    ].join('\n');
    const output = redactSecrets(input);
    expect(output).not.toContain('sk_sakura_8eQyfFJG');
    expect(output).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
    expect(output).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(output).not.toContain('hunter2secret');
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(output).not.toContain('BEGIN RSA PRIVATE KEY-----\nabc');
    expect(output).toContain('[REDACTED');
  });

  it('leaves ordinary prose untouched', () => {
    const prose = '我们决定用 pnpm 管理依赖，并把 CI 换成 GitHub Actions。';
    expect(redactSecrets(prose)).toBe(prose);
  });
});

describe('configuration', () => {
  it('clamps intervals and fills defaults', () => {
    const config = normalizeConfig({ intervalMinutes: 0, maxTaskAgeDays: -5 });
    expect(config.intervalMinutes).toBe(1);
    expect(config.maxTaskAgeDays).toBe(0);
    expect(config.clineTasksDir).toBe(defaultClineTasksDir());
    expect(normalizeConfig({ intervalMinutes: 99_999 }).intervalMinutes).toBe(1440);
  });

  it('reports actionable problems for unusable settings', () => {
    expect(validateConfig(normalizeConfig({ mcpUrl: 'not-a-url', token: 'nope' }))).toEqual([
      'MCP 地址不是合法的 URL。', 'Agent 密钥应以 sk_sakura_ 开头。'
    ]);
    expect(validateConfig(normalizeConfig({ mcpUrl: 'https://mcp.example.com/mcp', token: 'sk_sakura_abc' }))).toEqual([]);
  });

  it('masks tokens for display without revealing the secret', () => {
    expect(mask('sk_sakura_8eQyfFJG_U1QRS0abcdef')).toBe('sk_sakura_********cdef');
    expect(mask('short')).toBe('*****');
    expect(mask('')).toBe('');
  });
});

describe('MCP SSE parsing', () => {
  it('extracts JSON from an SSE frame and from a bare JSON body', () => {
    expect(parseSse('event: message\ndata: {"result":{"ok":true}}\n\n')).toEqual({ result: { ok: true } });
    expect(parseSse('{"result":1}')).toEqual({ result: 1 });
    expect(() => parseSse('   ')).toThrow('空响应');
    expect(() => parseSse('404 Not Found')).toThrow('无法解析响应');
  });
});
