import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { dataDir } from './config.js';

/**
 * Makes the systray helper binary executable from a packaged single-file build.
 *
 * systray2 spawns a native `tray_*` binary that it resolves in this order:
 *   1. `./traybin/<name>` relative to the current working directory
 *   2. `<systray2 package dir>/traybin/<name>`
 *
 * Inside a pkg executable step 2 lands in the read-only `/snapshot` virtual
 * filesystem, which cannot be executed. We therefore copy the binary out to the
 * per-user data directory once and `chdir` there so step 1 wins. Copying from
 * `/snapshot` works because pkg patches `fs` to serve snapshot reads.
 */

const BIN_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'tray_windows_release.exe',
  darwin: 'tray_darwin_release',
  linux: 'tray_linux_release'
};

/** True when running inside a pkg/SEA single-file executable. */
export function isPackaged(argv = process.argv, execPath = process.execPath): boolean {
  if ('pkg' in process) return true;
  // SEA builds run the executable directly rather than `node script.js`.
  return argv[1] === execPath;
}

export function trayBinaryName(platform: NodeJS.Platform = process.platform): string | undefined {
  return BIN_NAMES[platform];
}

/**
 * Copies the tray binary next to the config so systray2's CWD-relative lookup
 * finds a real, executable file. Returns the directory that must become the CWD,
 * or undefined when nothing needs to be done.
 */
export async function prepareTrayBinary(options: {
  packaged?: boolean; platform?: NodeJS.Platform; targetDir?: string;
} = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const packaged = options.packaged ?? isPackaged();
  if (!packaged) return undefined;
  const binName = trayBinaryName(platform);
  if (!binName) return undefined;

  const targetDir = options.targetDir ?? dataDir();
  const trayDir = join(targetDir, 'traybin');
  const destination = join(trayDir, binName);
  if (await exists(destination)) return targetDir;

  const source = resolveSnapshotBinary(binName);
  if (!source) throw new Error(`未在打包内容中找到托盘可执行文件：${binName}`);
  await mkdir(trayDir, { recursive: true });
  // Read + write rather than copyFile: pkg's SEA virtual filesystem serves
  // reads through fs.readFile but copyFile does not go through the same hook.
  await writeFile(destination, await readFile(source));
  // Windows ignores the mode; POSIX needs the execute bit.
  if (platform !== 'win32') await chmod(destination, 0o755);
  return targetDir;
}

/**
 * Locates the bundled binary. In a packaged build the asset lives under the
 * snapshot root, which `require.resolve` reports; from source it resolves to the
 * real node_modules path. Several candidate layouts are tried because pkg and
 * SEA place assets slightly differently.
 */
function resolveSnapshotBinary(binName: string): string | undefined {
  const candidates: string[] = [];
  try {
    const require = createRequire(import.meta.url);
    candidates.push(join(dirname(require.resolve('systray2/package.json')), 'traybin', binName));
  } catch { /* resolution can fail inside a snapshot; fall through */ }
  // pkg mirrors the project tree under the snapshot root.
  const snapshotRoot = process.platform === 'win32' ? 'C:\\snapshot' : '/snapshot';
  candidates.push(join(snapshotRoot, 'cline-sync', 'node_modules', 'systray2', 'traybin', binName));
  candidates.push(join(process.cwd(), 'node_modules', 'systray2', 'traybin', binName));
  return candidates.find(candidate => existsSync(candidate));
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch { return false; }
}
