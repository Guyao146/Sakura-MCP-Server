import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Principal } from './auth.js';

export class AuditLogger {
  constructor(private readonly filePath: string) {}
  async write(principal: Principal, tool: string, result: 'success' | 'error', details: Record<string, unknown> = {}): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify({ timestamp: new Date().toISOString(), principalId: principal.id, authSource: principal.source, tool, result, ...details })}\n`, { mode: 0o600 });
  }
}
