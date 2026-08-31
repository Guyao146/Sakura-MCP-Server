/**
 * Scheduler wrapping the sync engine: fixed-interval scans, single-flight
 * guarding (a long extraction never overlaps with the next tick), and status the
 * tray and config panel can read.
 */
import { McpClient } from './mcp-client.js';
import { runSync, type SyncSummary } from './sync.js';
import type { SyncConfig } from './config.js';
import type { PanelStatus } from './gui.js';

export class SyncScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastRunAt: number | null = null;
  private nextRunAt: number | null = null;
  private lastResult: string | null = null;
  private recent: SyncSummary['outcomes'] = [];

  constructor(private config: SyncConfig, private readonly log: (message: string) => void) {}

  updateConfig(config: SyncConfig): void {
    this.config = config;
    this.restart();
  }

  status(): PanelStatus {
    return {
      enabled: this.config.enabled,
      running: this.running,
      lastRunAt: this.lastRunAt ? new Date(this.lastRunAt).toLocaleString() : null,
      nextRunAt: this.nextRunAt ? new Date(this.nextRunAt).toLocaleString() : null,
      lastResult: this.lastResult,
      recent: this.recent.slice(-12).reverse()
    };
  }

  restart(): void {
    this.stop();
    if (!this.config.enabled) { this.nextRunAt = null; this.log('自动同步已关闭'); return; }
    const period = this.config.intervalMinutes * 60_000;
    this.nextRunAt = Date.now() + period;
    this.timer = setInterval(() => void this.runOnce(), period);
    // Do not hold the event loop open purely for the timer.
    this.timer.unref?.();
    this.log(`自动同步已启用，每 ${this.config.intervalMinutes} 分钟扫描一次`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Runs a scan unless one is already in flight. */
  async runOnce(): Promise<SyncSummary | undefined> {
    if (this.running) { this.log('上一次同步仍在进行，跳过本次触发'); return undefined; }
    if (!this.config.mcpUrl || !this.config.token) { this.lastResult = '未配置 MCP 地址或密钥'; return undefined; }
    this.running = true;
    try {
      const summary = await runSync(this.config, { logger: this.log });
      this.lastRunAt = Date.now();
      this.recent = summary.outcomes;
      this.lastResult = `扫描 ${summary.scanned} 个任务：${summary.synced} 已同步 / ${summary.skipped} 跳过 / ${summary.failed} 失败`;
      this.log(this.lastResult);
      return summary;
    } catch (error) {
      this.lastResult = `同步失败：${error instanceof Error ? error.message : String(error)}`;
      this.log(this.lastResult);
      return undefined;
    } finally {
      this.running = false;
      if (this.config.enabled) this.nextRunAt = Date.now() + this.config.intervalMinutes * 60_000;
    }
  }

  async testConnection(config: SyncConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      await new McpClient(config.mcpUrl, config.token).initialize();
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
}
