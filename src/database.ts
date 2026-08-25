import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export class Database {
  readonly pool: pg.Pool;
  constructor(connectionString: string, maxConnections: number) {
    this.pool = new Pool({ connectionString, max: maxConnections, statement_timeout: 15_000, application_name: 'Sakura-MCP-Server' });
  }
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }
  async migrate(directory = join(process.cwd(), 'migrations')): Promise<void> {
    await this.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const migration = '001_memory_platform.sql';
    const exists = await this.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migration]);
    if (exists.rowCount) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(join(directory, migration), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [migration]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  close(): Promise<void> { return this.pool.end(); }
}
