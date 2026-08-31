import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, normalizeConfig, type SyncConfig } from './config.js';

/**
 * Persists config.json and cursors.json in the per-user data directory.
 * `cursors` records how many messages of each task have already been pushed so
 * only the incremental tail is re-extracted, keeping Chat-provider cost down and
 * avoiding duplicate memories.
 */

export type Cursors = Record<string, { messageCount: number; syncedAt: string }>;

function configPath(dir = dataDir()): string { return join(dir, 'config.json'); }
function cursorsPath(dir = dataDir()): string { return join(dir, 'cursors.json'); }

export async function loadConfig(dir = dataDir()): Promise<SyncConfig> {
  try {
    const raw = await readFile(configPath(dir), 'utf8');
    return normalizeConfig(JSON.parse(raw) as Partial<SyncConfig>);
  } catch { return normalizeConfig({}); }
}

export async function saveConfig(config: SyncConfig, dir = dataDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  // mode 0o600: the file holds the Agent token.
  await writeFile(configPath(dir), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function loadCursors(dir = dataDir()): Promise<Cursors> {
  try {
    const raw = await readFile(cursorsPath(dir), 'utf8');
    const parsed = JSON.parse(raw) as Cursors;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export async function saveCursors(cursors: Cursors, dir = dataDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(cursorsPath(dir), JSON.stringify(cursors, null, 2), { mode: 0o600 });
}
