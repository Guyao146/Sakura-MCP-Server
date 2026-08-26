import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Principal } from './auth.js';
import type { Database } from './database.js';
import { requireSpaceRole } from './memory/permissions.js';

const sensitivePattern = /(token|secret|password|api.?key|authorization|cookie|content|excerpt|code_verifier|nonce)/i;

export interface AuditEvent {
  actorUserId?: string; agentId?: string; spaceId?: string; authSource?: string;
  action: string; targetType?: string; targetId?: string; result: 'success'|'error'; metadata?: Record<string, unknown>;
}

export class AuditLogger {
  constructor(private readonly filePath: string, private readonly database?: Database) {}

  async write(principal: Principal, action: string, result: 'success'|'error', details: Record<string, unknown> = {}, actorUserId?: string): Promise<void> {
    return this.record({ actorUserId, agentId: principal.agentId, authSource: principal.source, action, result, metadata: details });
  }

  async record(event: AuditEvent): Promise<void> {
    const sanitized = sanitize(event.metadata ?? {});
    const timestamp = new Date().toISOString();
    const entry = { timestamp, ...event, metadata: sanitized };
    const operations: Promise<unknown>[] = [this.append(entry)];
    if (this.database) operations.push(this.database.query(
      `INSERT INTO audit_logs(actor_user_id,agent_id,space_id,auth_source,action,target_type,target_id,result,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [event.actorUserId ?? null, event.agentId ?? null, event.spaceId ?? null, event.authSource ?? null,
        event.action, event.targetType ?? null, event.targetId ?? null, event.result, sanitized]));
    await Promise.allSettled(operations);
  }

  async list(userId: string, options: { spaceId?: string; action?: string; result?: string; limit: number; cursor?: number; systemAdmin?: boolean }) {
    if (options.spaceId) await requireSpaceRole(this.database!, userId, options.spaceId, 'viewer');
    const result = await this.database!.query(
      `SELECT al.id,al.actor_user_id,al.agent_id,al.space_id,al.auth_source,al.action,al.target_type,al.target_id,
       al.result,al.metadata,al.request_id,al.created_at,u.display_name AS actor_name,u.email AS actor_email
       FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id
       WHERE ($1::boolean=true OR al.actor_user_id=$2 OR EXISTS(
         SELECT 1 FROM space_members sm WHERE sm.space_id=al.space_id AND sm.user_id=$2 AND sm.role IN ('owner','admin')))
       AND ($3::uuid IS NULL OR al.space_id=$3) AND ($4::text IS NULL OR al.action=$4)
       AND ($5::text IS NULL OR al.result=$5) AND ($6::bigint IS NULL OR al.id<$6)
       ORDER BY al.id DESC LIMIT $7`,
      [options.systemAdmin ?? false, userId, options.spaceId ?? null, options.action ?? null,
        options.result ?? null, options.cursor ?? null, options.limit]);
    const rows = result.rows;
    return { events: rows, nextCursor: rows.length === options.limit ? rows[rows.length - 1].id : null };
  }

  private async append(entry: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…[TRUNCATED]`;
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    [key, sensitivePattern.test(key) ? '[REDACTED]' : sanitize(item, depth + 1)]));
}