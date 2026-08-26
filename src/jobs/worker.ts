import { randomUUID } from 'node:crypto';
import type { Database } from '../database.js';
import type { SemanticMemoryService } from '../semantic/service.js';
import { JobRepository, type BackgroundJob } from './repository.js';

export class BackgroundWorker {
  private readonly id = `worker-${randomUUID()}`;
  private readonly jobs: JobRepository;
  private timer?: NodeJS.Timeout;
  private stopping = false;

  constructor(private readonly database: Database, private readonly semantic: SemanticMemoryService,
    private readonly pollIntervalMs: number, private readonly staleAfterSeconds: number,
    private readonly log: { info(value: unknown, message: string): void; error(value: unknown, message: string): void }) {
    this.jobs = new JobRepository(database);
  }

  start(): void {
    if (this.timer) return;
    const poll = async () => {
      if (this.stopping) return;
      try { await this.runOnce(); }
      catch (error) { this.log.error({ err: error, workerId: this.id }, 'Background worker poll failed'); }
      if (!this.stopping) this.timer = setTimeout(poll, this.pollIntervalMs);
    };
    this.timer = setTimeout(poll, 50);
    this.log.info({ workerId: this.id }, 'Background worker started');
  }

  stop(): void { this.stopping = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }

  async runOnce(): Promise<boolean> {
    const job = await this.jobs.claim(this.id, this.staleAfterSeconds);
    if (!job) return false;
    try {
      if (job.job_type === 'rebuild_embeddings') await this.rebuild(job);
      else throw new Error(`Unsupported background job type: ${job.job_type}`);
    } catch (error) {
      await this.jobs.fail(job, error instanceof Error ? error.message : 'Background job failed.', job.progress);
      this.log.error({ err: error, jobId: job.id }, 'Background job failed');
    }
    return true;
  }

  private async rebuild(job: BackgroundJob): Promise<void> {
    const ids = await this.database.query<{ id: string }>(
      `SELECT id FROM memories WHERE space_id=$1 AND status IN ('active','pending_confirmation') AND deleted_at IS NULL ORDER BY created_at`,
      [job.space_id]);
    const errors: Array<{ memoryId: string; message: string }> = [];
    let completed = 0;
    for (const row of ids.rows) {
      try {
        const result = await this.semantic.rebuildEmbedding(job.requested_by, row.id);
        if (result.status === 'failed') errors.push({ memoryId: row.id, message: 'Embedding failed; see memory_embeddings.error.' });
        else completed += 1;
      } catch (error) { errors.push({ memoryId: row.id, message: error instanceof Error ? error.message : 'Embedding failed.' }); }
      const progress = { total: ids.rows.length, completed, failed: errors.length, errors: errors.slice(0, 100) };
      if (await this.jobs.progress(job.id, progress)) { await this.jobs.complete(job.id, progress); return; }
    }
    await this.jobs.complete(job.id, { total: ids.rows.length, completed, failed: errors.length, errors: errors.slice(0, 100) });
  }
}