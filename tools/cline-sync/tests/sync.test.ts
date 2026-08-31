import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../src/sync.js';
import { normalizeConfig } from '../src/config.js';
import type { McpClient } from '../src/mcp-client.js';

const message = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });

async function makeTasksDir(tasks: Record<string, unknown[]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cline-sync-run-'));
  for (const [taskId, messages] of Object.entries(tasks)) {
    const dir = join(root, taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'api_conversation_history.json'), JSON.stringify(messages), 'utf8');
  }
  return root;
}

function fakeClient(): McpClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    initialize: async () => undefined,
    extractAndRemember: async (text: string) => { calls.push(text); return { ok: true }; }
  } as unknown as McpClient & { calls: string[] };
}

describe('incremental sync', () => {
  it('pushes only new messages and advances the cursor', async () => {
    const dir = await makeTasksDir({ '1700000000010': [message('user', 'first task detail'), message('assistant', 'first answer detail')] });
    const config = normalizeConfig({ mcpUrl: 'https://mcp.example.com/mcp', token: 'sk_sakura_x', clineTasksDir: dir, maxTaskAgeDays: 0 });
    const client = fakeClient();
    const cursors = {};

    const first = await runSync(config, { client, cursors, persist: false });
    expect(first.synced).toBe(1);
    expect(client.calls).toHaveLength(1);

    // No new messages: the second run is a no-op.
    const second = await runSync(config, { client, cursors, persist: false });
    expect(second.synced).toBe(0);
    expect(second.skipped).toBe(1);
    expect(client.calls).toHaveLength(1);
  });

  it('re-syncs from scratch when a task is restored to fewer messages', async () => {
    const dir = await makeTasksDir({ '1700000000011': [message('user', 'a detail one'), message('assistant', 'b detail two')] });
    const config = normalizeConfig({ mcpUrl: 'https://mcp.example.com/mcp', token: 'sk_sakura_x', clineTasksDir: dir, maxTaskAgeDays: 0 });
    const client = fakeClient();
    const cursors = { '1700000000011': { messageCount: 9, syncedAt: '2020-01-01T00:00:00Z' } };
    const summary = await runSync(config, { client, cursors, persist: false });
    expect(summary.synced).toBe(1);
    expect(client.calls[0]).toContain('a detail one');
  });

  it('keeps the cursor unchanged when the upload fails so the next run retries', async () => {
    const dir = await makeTasksDir({ '1700000000012': [message('user', 'x detail one'), message('assistant', 'y detail two')] });
    const config = normalizeConfig({ mcpUrl: 'https://mcp.example.com/mcp', token: 'sk_sakura_x', clineTasksDir: dir, maxTaskAgeDays: 0 });
    const cursors = {};
    const failing = { extractAndRemember: async () => ({ ok: false, error: 'boom' }), initialize: async () => undefined } as unknown as McpClient;
    const summary = await runSync(config, { client: failing, cursors, persist: false });
    expect(summary.failed).toBe(1);
    expect(cursors).toEqual({});
  });

  it('skips tasks older than the configured age window', async () => {
    const dir = await makeTasksDir({ '1700000000013': [message('user', 'old task one'), message('assistant', 'old task two')] });
    const config = normalizeConfig({ mcpUrl: 'https://mcp.example.com/mcp', token: 'sk_sakura_x', clineTasksDir: dir, maxTaskAgeDays: 1 });
    const client = fakeClient();
    // now = far in the future so the freshly written file is "old".
    const summary = await runSync(config, { client, cursors: {}, persist: false, now: () => Date.now() + 10 * 86_400_000 });
    expect(summary.skipped).toBe(1);
    expect(client.calls).toHaveLength(0);
  });
});
