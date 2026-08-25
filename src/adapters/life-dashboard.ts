import type { AppConfig } from '../config.js';

/** Adapter for a future service-to-service internal API. Never proxies user OAuth tokens. */
export class LifeDashboardAdapter {
  constructor(private readonly config: NonNullable<AppConfig['lifeDashboard']>) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.internalUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${this.config.internalToken}`, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Life Dashboard internal API failed (${response.status}).`);
    return response.json() as Promise<T>;
  }
  overview() { return this.request<unknown>('/overview'); }
  workspaces() { return this.request<unknown>('/dsh/workspaces'); }
  sendFollowup(workspaceId: string, sessionId: string, message: string) { return this.request<unknown>('/dsh/followups', { method: 'POST', body: JSON.stringify({ workspaceId, sessionId, message }) }); }
}
